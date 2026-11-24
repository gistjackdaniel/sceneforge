const databaseName = "sceneforge-shot-worlds";
const storeName = "geometry";

const withGeometryStore = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("로컬 3D 에셋 저장소를 열 수 없습니다."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error("로컬 3D 에셋을 읽거나 저장할 수 없습니다."));
    });
  } finally {
    database.close();
  }
};

export const geometrySha256 = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const writeGeometry = (hash: string, bytes: ArrayBuffer): Promise<IDBValidKey> =>
  withGeometryStore("readwrite", (store) => store.put(bytes, hash));

export const readGeometry = async (hash: string): Promise<ArrayBuffer> => {
  const bytes: unknown = await withGeometryStore("readonly", (store) => store.get(hash));
  if (!(bytes instanceof ArrayBuffer)) throw new Error("이 브라우저에 해당 GLB 파일이 없습니다.");
  return bytes;
};
