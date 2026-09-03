import { removeAccountStorageObjects } from "./accountDeletion.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const createStorageMock = (initialPaths: string[]) => {
  const objects = new Set(initialPaths);
  const removedBatches: string[][] = [];

  const list = async (prefix: string, options: { limit: number; offset: number }) => {
    const childNames = new Map<string, boolean>();
    for (const path of objects) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const remainder = path.slice(prefix.length + 1);
      const [name, ...tail] = remainder.split("/");
      childNames.set(name, tail.length === 0);
    }

    const entries = [...childNames.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(options.offset, options.offset + options.limit)
      .map(([name, isObject]) => ({
        name,
        id: isObject ? `object:${name}` : null,
        metadata: isObject ? {} : null,
      }));
    return { data: entries, error: null };
  };

  const remove = async (paths: string[]) => {
    removedBatches.push(paths);
    paths.forEach((path) => objects.delete(path));
    return { data: paths, error: null };
  };

  return {
    client: {
      storage: {
        from: () => ({ list, remove }),
      },
    },
    objects,
    removedBatches,
  };
};

Deno.test("account deletion removes final and nested quarantine objects under the owner prefix", async () => {
  const fixture = createStorageMock([
    `${USER_ID}/avatar.webp`,
    `${USER_ID}/.quarantine/pending.webp`,
    `${USER_ID}/nested/legacy/photo.png`,
    "22222222-2222-4222-8222-222222222222/untouched.webp",
  ]);

  await removeAccountStorageObjects(
    fixture.client as never,
    USER_ID,
    [`${USER_ID}/avatar.webp`],
  );

  assert(
    [...fixture.objects].every((path) => !path.startsWith(`${USER_ID}/`)),
    "all owner-prefixed objects must be deleted",
  );
  assert(
    fixture.objects.has("22222222-2222-4222-8222-222222222222/untouched.webp"),
    "another account's object must remain untouched",
  );
  assert(
    fixture.removedBatches.flat().includes(`${USER_ID}/.quarantine/pending.webp`),
    "quarantine objects must be part of deletion",
  );
});

Deno.test("account deletion fails closed when storage verification still finds an object", async () => {
  const fixture = createStorageMock([`${USER_ID}/stubborn.webp`]);
  fixture.client.storage.from = () => ({
    list: async (prefix: string, options: { limit: number; offset: number }) => {
      const name = "stubborn.webp";
      return prefix === USER_ID && options.offset === 0
        ? { data: [{ name, id: `object:${name}`, metadata: {} }], error: null }
        : { data: [], error: null };
    },
    remove: async (paths: string[]) => ({ data: paths, error: null }),
  });

  let rejected = false;
  try {
    await removeAccountStorageObjects(fixture.client as never, USER_ID, []);
  } catch (error) {
    rejected = error instanceof Error
      && error.message === "Account storage objects remained after deletion.";
  }
  assert(rejected, "verification must reject incomplete storage deletion");
});
