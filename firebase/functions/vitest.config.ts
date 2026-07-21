import { defineConfig } from "vitest/config";

// Integration tests — drive the LIVE express app (src/api.ts) with supertest
// against the Firestore + Auth emulators. REQUIRES the emulators running:
//   cd firebase && npm run emulators
// then, in another terminal:  cd firebase/functions && npm test
// One-shot (CI-style):        cd firebase && npm run test:integration
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: "./test/global-setup.ts",
    setupFiles: ["./test/setup.ts"],
    // Emulator round-trips + token minting are slower than unit tests; the
    // default 5s flakes.
    testTimeout: 15000,
    // All test files share one Firestore emulator and clearFirestore() wipes
    // everything — parallel files would trash each other's data.
    fileParallelism: false,
  },
});
