#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  CH_EXTENSION_ID=<extension-id> pnpm acceptance:real -- --site deepseek --matrix full

Options:
  --site deepseek|zai          Target chat site.
  --matrix no-harness|skill-only|mcp-only|full
                              Capability matrix to verify.
  --extension-id <id>          Chrome extension id. Can also use CH_EXTENSION_ID.
  --question <text>            Optional question text. Defaults to a unique smoke prompt.
  --task-space <name>          Optional ego-browser task space name.
  --timeout <seconds>          Poll timeout for extension rewrite. Default: 45.
USAGE
}

site=""
matrix=""
extension_id="${CH_EXTENSION_ID:-}"
question=""
task_space="c-harness real acceptance"
timeout_seconds="45"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --site)
      site="${2:-}"
      shift 2
      ;;
    --matrix)
      matrix="${2:-}"
      shift 2
      ;;
    --extension-id)
      extension_id="${2:-}"
      shift 2
      ;;
    --question)
      question="${2:-}"
      shift 2
      ;;
    --task-space)
      task_space="${2:-}"
      shift 2
      ;;
    --timeout)
      timeout_seconds="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$site" in
  deepseek|zai) ;;
  *)
    echo "--site must be deepseek or zai." >&2
    exit 2
    ;;
esac

case "$matrix" in
  no-harness|skill-only|mcp-only|full) ;;
  *)
    echo "--matrix must be no-harness, skill-only, mcp-only, or full." >&2
    exit 2
    ;;
esac

if [[ -z "$extension_id" ]]; then
  echo "Missing extension id. Set CH_EXTENSION_ID or pass --extension-id." >&2
  exit 2
fi

if [[ -z "$question" ]]; then
  question="ACCEPT_${site}_${matrix}_$(date +%Y%m%d_%H%M%S) 只回复 OK"
fi

export C_HARNESS_ACCEPTANCE_SITE="$site"
export C_HARNESS_ACCEPTANCE_MATRIX="$matrix"
export C_HARNESS_ACCEPTANCE_EXTENSION_ID="$extension_id"
export C_HARNESS_ACCEPTANCE_QUESTION="$question"
export C_HARNESS_ACCEPTANCE_TASK_SPACE="$task_space"
export C_HARNESS_ACCEPTANCE_TIMEOUT_SECONDS="$timeout_seconds"

# Step 1：运行真实页面验收。脚本内部会备份并恢复扩展 IndexedDB。
ego-browser nodejs <<'EOF'
const site = process.env.C_HARNESS_ACCEPTANCE_SITE
const matrix = process.env.C_HARNESS_ACCEPTANCE_MATRIX
const extensionId = process.env.C_HARNESS_ACCEPTANCE_EXTENSION_ID
const question = process.env.C_HARNESS_ACCEPTANCE_QUESTION
const taskSpaceName = process.env.C_HARNESS_ACCEPTANCE_TASK_SPACE
const timeoutSeconds = Number(process.env.C_HARNESS_ACCEPTANCE_TIMEOUT_SECONDS || '45')

const sites = {
  deepseek: {
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    composerSelector: 'textarea[name="search"]',
    sendSelector: '[role="button"].ds-button--primary.ds-button--filled.ds-button--circle',
    urlPattern: /^https:\/\/chat\.deepseek\.com\/(?:$|a\/chat\/s\/)/u
  },
  zai: {
    label: 'Z.ai',
    url: 'https://chat.z.ai/',
    composerSelector: 'textarea#chat-input',
    sendSelector: 'button#send-message-button',
    urlPattern: /^https:\/\/chat\.z\.ai\/(?:$|c\/)/u
  }
}

const expected = {
  'no-harness': {
    skillEnabled: false,
    mcpEnabled: false,
    requiresSkill: false,
    requiresMcp: false,
    includes: [question],
    excludes: ['我们按下面的约定完成这次问题：', '当前 Skill 目录：', '当前 MCP 服务目录：']
  },
  'skill-only': {
    skillEnabled: true,
    mcpEnabled: false,
    requiresSkill: true,
    requiresMcp: false,
    includes: ['我们按下面的约定完成这次问题：', '当前 Skill 目录：', question],
    excludes: ['当前 MCP 服务目录：']
  },
  'mcp-only': {
    skillEnabled: false,
    mcpEnabled: true,
    requiresSkill: false,
    requiresMcp: true,
    includes: ['我们按下面的约定完成这次问题：', '当前 MCP 服务目录：', question],
    excludes: ['当前 Skill 目录：']
  },
  full: {
    skillEnabled: true,
    mcpEnabled: true,
    requiresSkill: true,
    requiresMcp: true,
    includes: ['我们按下面的约定完成这次问题：', '当前 Skill 目录：', '当前 MCP 服务目录：', question],
    excludes: []
  }
}[matrix]

function stringify(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

async function runOnExtensionPage(source) {
  const extensionUrl = `chrome-extension://${extensionId}/options.html`
  await openOrReuseTab(extensionUrl, { wait: true, timeout: 20 })
  return await js(source)
}

function indexedDbHelpersSource(actionSource) {
  return String.raw`(async () => {
    async function openDatabase(name) {
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
    }

    async function readStore(database, storeName) {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly')
        const store = transaction.objectStore(storeName)
        const records = []
        const cursorRequest = store.openCursor()
        cursorRequest.onerror = () => reject(cursorRequest.error)
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          records.push({ key: cursor.key, value: cursor.value })
          cursor.continue()
        }
        transaction.oncomplete = () => resolve({ storeName, keyPath: store.keyPath, records })
        transaction.onerror = () => reject(transaction.error)
      })
    }

    async function writeStore(database, storeBackup) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeBackup.storeName, 'readwrite')
        const store = transaction.objectStore(storeBackup.storeName)
        store.clear()
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
      })
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeBackup.storeName, 'readwrite')
        const store = transaction.objectStore(storeBackup.storeName)
        for (const record of storeBackup.records) {
          if (storeBackup.keyPath) store.put(record.value)
          else store.put(record.value, record.key)
        }
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
      })
    }

    async function dumpDatabase(name) {
      const database = await openDatabase(name)
      const stores = []
      for (const storeName of database.objectStoreNames) {
        stores.push(await readStore(database, storeName))
      }
      database.close()
      return { name, stores }
    }

    async function restoreDatabase(backup) {
      const database = await openDatabase(backup.name)
      for (const store of backup.stores) await writeStore(database, store)
      database.close()
    }

    async function countStore(databaseName, storeName) {
      const database = await openDatabase(databaseName)
      const count = await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly')
        const request = transaction.objectStore(storeName).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      database.close()
      return count
    }

    async function setSkillEnabled(skillEnabled) {
      const database = await openDatabase('c-harness-settings')
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('settings', 'readwrite')
        const store = transaction.objectStore('settings')
        const getRequest = store.get('general')
        getRequest.onsuccess = () => {
          const current = getRequest.result || {}
          store.put({
            skillEnabled,
            reinjectionDelayMinSeconds: current.reinjectionDelayMinSeconds || 1,
            reinjectionDelayMaxSeconds: current.reinjectionDelayMaxSeconds || 3
          }, 'general')
        }
        getRequest.onerror = () => reject(getRequest.error)
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
    }

    async function clearMcpServices() {
      const database = await openDatabase('c-harness-mcp')
      for (const storeName of database.objectStoreNames) {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(storeName, 'readwrite')
          transaction.objectStore(storeName).clear()
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error)
        })
      }
      database.close()
    }

    ${actionSource}
  })()`
}

function pageHarnessSource(config, prompt) {
  return String.raw`(() => {
    const composer = document.querySelector(${JSON.stringify(config.composerSelector)})
    const sendControl = document.querySelector(${JSON.stringify(config.sendSelector)})
    if (!(composer instanceof HTMLTextAreaElement)) {
      return { ok: false, error: 'composer-not-found', url: location.href }
    }
    if (!(sendControl instanceof HTMLElement)) {
      return { ok: false, error: 'send-control-not-found', url: location.href }
    }

    const events = []
    window.__cHarnessAcceptance = { events, prompt: ${JSON.stringify(prompt)} }
    composer.addEventListener('input', () => {
      events.push({
        at: new Date().toISOString(),
        value: composer.value
      })
    }, true)

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!valueSetter) return { ok: false, error: 'textarea-setter-not-found', url: location.href }
    composer.focus()
    valueSetter.call(composer, ${JSON.stringify(prompt)})
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new Event('change', { bubbles: true }))
    sendControl.click()
    return { ok: true, url: location.href }
  })()`
}

function readEventsSource() {
  return String.raw`(() => {
    const state = window.__cHarnessAcceptance
    if (!state) return []
    return state.events || []
  })()`
}

function assertExpectations(text, rules) {
  const missing = rules.includes.filter((needle) => !text.includes(needle))
  const forbidden = rules.excludes.filter((needle) => text.includes(needle))
  return { pass: missing.length === 0 && forbidden.length === 0, missing, forbidden }
}

function summarizeText(text) {
  return text.replace(/\s+/gu, ' ').slice(0, 240)
}

const task = await useOrCreateTaskSpace(taskSpaceName)
const config = sites[site]
let backup = null

try {
  backup = await runOnExtensionPage(indexedDbHelpersSource(String.raw`
    return {
      settings: await dumpDatabase('c-harness-settings'),
      skills: await dumpDatabase('c-harness'),
      mcp: await dumpDatabase('c-harness-mcp'),
      skillCount: await countStore('c-harness', 'skills'),
      mcpCount: await countStore('c-harness-mcp', 'services')
    }
  `))

  if (expected.requiresSkill && backup.skillCount < 1) {
    throw new Error(`${matrix} requires at least one imported Skill in extension IndexedDB.`)
  }
  if (expected.requiresMcp && backup.mcpCount < 1) {
    throw new Error(`${matrix} requires at least one MCP service in extension IndexedDB.`)
  }

  await runOnExtensionPage(indexedDbHelpersSource(`
    await setSkillEnabled(${expected.skillEnabled ? 'true' : 'false'})
    ${expected.mcpEnabled ? '' : 'await clearMcpServices()'}
    return {
      skillEnabled: ${expected.skillEnabled ? 'true' : 'false'},
      mcpEnabled: ${expected.mcpEnabled ? 'true' : 'false'},
      skillCount: await countStore('c-harness', 'skills'),
      mcpCount: await countStore('c-harness-mcp', 'services')
    }
  `))

  await openOrReuseTab(config.url, { wait: true, timeout: 30 })
  const observed = await js(pageHarnessSource(config, question))
  if (!observed.ok) throw new Error(`DOM probe failed: ${stringify(observed)}`)
  if (!config.urlPattern.test(observed.url)) throw new Error(`Unexpected URL shape: ${observed.url}`)

  const deadline = Date.now() + timeoutSeconds * 1000
  let finalText = ''
  let assertion = assertExpectations('', expected)
  while (Date.now() < deadline) {
    await wait(1)
    const events = await js(readEventsSource())
    for (const event of events) {
      const candidate = event.value || ''
      const candidateAssertion = assertExpectations(candidate, expected)
      if (candidateAssertion.pass || candidate.length > finalText.length) {
        finalText = candidate
        assertion = candidateAssertion
      }
    }
    if (assertion.pass) break
  }

  if (!assertion.pass) {
    throw new Error(`Acceptance assertion failed. Missing: ${assertion.missing.join(', ') || '(none)'}; forbidden: ${assertion.forbidden.join(', ') || '(none)'}; latest: ${summarizeText(finalText)}`)
  }

  const markdown = [
    `- ${new Date().toISOString().slice(0, 10)}，${config.label} ${matrix} SOP 验收通过：任务空间 \`${taskSpaceName}\`，URL 形态 \`${observed.url}\`，输入框 \`${config.composerSelector}\`，发送控件 \`${config.sendSelector}\`；实际写入文本长度 \`${finalText.length}\`，问题标记 \`${question}\`。`,
    `  - 文本摘要：${summarizeText(finalText)}`
  ].join('\n')
  cliLog(markdown)
} finally {
  if (backup) {
    await runOnExtensionPage(indexedDbHelpersSource(`
      await restoreDatabase(${JSON.stringify(backup.settings)})
      await restoreDatabase(${JSON.stringify(backup.skills)})
      await restoreDatabase(${JSON.stringify(backup.mcp)})
      return { restored: true }
    `))
  }
}
EOF

# Step 2：验收脚本完成后关闭任务空间，避免遗留浏览器上下文。
ego-browser nodejs <<'EOF'
const taskSpaceName = process.env.C_HARNESS_ACCEPTANCE_TASK_SPACE
await completeTaskSpace(taskSpaceName, { keep: false })
cliLog(`closed task space: ${taskSpaceName}`)
EOF
