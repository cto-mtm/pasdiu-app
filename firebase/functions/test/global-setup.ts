// Fails fast with a clear message when the emulators aren't up, so a
// developer never mistakes "emulator not running" for "tests failing".
// (globalSetup runs once, before setupFiles — read env with defaults.)
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

export default async function setup(): Promise<void> {
  for (const [name, host] of [
    ["Firestore", FIRESTORE],
    ["Auth", AUTH],
  ] as const) {
    try {
      // Any HTTP response (even a 404) means the emulator is listening.
      await fetch(`http://${host}/`);
    } catch {
      throw new Error(
        `\n\n${name} emulator not reachable at ${host}.\n` +
          `Start the emulators first:  cd firebase && npm run emulators\n`
      );
    }
  }
}
