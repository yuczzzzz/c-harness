import { requestLegacyProjectBindingDatabaseDeletion } from "@/session-knowledge/legacy-project-database";

describe("requestLegacyProjectBindingDatabaseDeletion", () => {
  it("requests deletion without waiting for success", () => {
    const factory = new FakeIdbFactory();

    expect(() => requestLegacyProjectBindingDatabaseDeletion("legacy-db", factory as unknown as IDBFactory))
      .not.toThrow();

    expect(factory.deletedNames).toEqual(["legacy-db"]);
    expect(typeof factory.lastRequest?.onsuccess).toBe("function");
  });

  it.each(["onblocked", "onerror"] as const)("keeps %s non-blocking", (eventName) => {
    const factory = new FakeIdbFactory();

    requestLegacyProjectBindingDatabaseDeletion("legacy-db", factory as unknown as IDBFactory);

    const request = factory.lastRequest as IDBOpenDBRequest;
    const handler = request[eventName] as ((event: Event) => void) | null;
    expect(() => handler?.call(request, new Event(eventName))).not.toThrow();
  });

  it("swallows synchronous deleteDatabase failures so startup can retry later", () => {
    const factory = {
      deleteDatabase: vi.fn(() => {
        throw new Error("blocked by environment");
      })
    };

    expect(() => requestLegacyProjectBindingDatabaseDeletion("legacy-db", factory as unknown as IDBFactory))
      .not.toThrow();
  });
});

class FakeIdbFactory {
  readonly deletedNames: string[] = [];
  lastRequest: Partial<IDBOpenDBRequest> | null = null;

  deleteDatabase(name: string): IDBOpenDBRequest {
    this.deletedNames.push(name);
    this.lastRequest = {};
    return this.lastRequest as IDBOpenDBRequest;
  }
}
