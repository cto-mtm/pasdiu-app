// Inspect the Stripe price catalog and assign the lookup keys the API resolves
// prices by. Read-only unless you pass --apply.
//
//   # what does the API see right now? (test mode)
//   STRIPE_SECRET_KEY=sk_test_… node stripe-setup.mjs
//
//   # tag the prices you actually sell (writes to Stripe)
//   STRIPE_SECRET_KEY=sk_test_… node stripe-setup.mjs --apply \
//     studio_monthly=price_123 studio_annual=price_456 \
//     agency_monthly=price_789 agency_annual=price_abc
//
// Run it once per Stripe account — test mode AND live mode have separate
// catalogs, so live prices need their own lookup keys.
//
// Why lookup keys: a lookup key is unique per account and is the price's
// stable handle. Without one the API has to guess which price belongs to which
// plan from the product name, which breaks the moment the catalog is
// restructured (e.g. monthly/annual moving from separate products to two
// prices on one product) or a price is superseded. Keys mirror
// PRICE_LOOKUP_KEYS in src/helpers/stripe.ts.
import Stripe from "stripe";

const SLOTS = ["studio_monthly", "studio_annual", "agency_monthly", "agency_annual"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keyArg = args.indexOf("--key");
const secret = keyArg !== -1 ? args[keyArg + 1] : process.env.STRIPE_SECRET_KEY;

if (!secret) {
  console.error("No Stripe key. Set STRIPE_SECRET_KEY=sk_… or pass --key sk_…");
  process.exit(1);
}
const stripe = new Stripe(secret);
const mode = secret.startsWith("sk_live") ? "LIVE" : "test";
const money = (p) =>
  p.unit_amount == null ? "—" : `${(p.unit_amount / 100).toFixed(2)} ${p.currency.toUpperCase()}`;

// ── --apply: assign lookup keys ────────────────────────────────────────────
if (apply) {
  const pairs = args
    .filter((a) => a.includes("="))
    .map((a) => a.split("=", 2));
  const bad = pairs.filter(([slot]) => !SLOTS.includes(slot));
  if (!pairs.length || bad.length) {
    console.error(`--apply needs <slot>=<price_id> pairs. Slots: ${SLOTS.join(", ")}`);
    process.exit(1);
  }
  console.log(`Assigning lookup keys in ${mode} mode…\n`);
  for (const [slot, priceId] of pairs) {
    try {
      // transfer_lookup_key moves the key off whatever price holds it today —
      // that is how you point a slot at a newly created price.
      const price = await stripe.prices.update(priceId, {
        lookup_key: slot,
        transfer_lookup_key: true,
      });
      console.log(`  ${slot.padEnd(16)} → ${price.id}  (${money(price)} / ${price.recurring?.interval ?? "one-time"})`);
    } catch (err) {
      console.error(`  ${slot.padEnd(16)} → FAILED: ${err.message}`);
    }
  }
  console.log("\nRe-run without --apply to verify.");
  process.exit(0);
}

// ── Default: report ────────────────────────────────────────────────────────
console.log(`Stripe catalog — ${mode} mode\n`);

const prices = await stripe.prices.list({ expand: ["data.product"], limit: 100 });
const recurring = prices.data.filter((p) => p.recurring);

console.log("ACTIVE RECURRING PRICES");
console.log("  price id                        lookup_key        interval  amount        product");
for (const p of recurring.filter((p) => p.active)) {
  const prod = typeof p.product === "object" && p.product ? p.product : null;
  const prodLabel = prod
    ? `${prod.name}${prod.active === false ? "  [PRODUCT ARCHIVED — Checkout rejects this price]" : ""}`
    : String(p.product);
  console.log(
    `  ${p.id.padEnd(31)} ${(p.lookup_key ?? "—").padEnd(17)} ${(p.recurring.interval).padEnd(9)} ${money(p).padEnd(13)} ${prodLabel}`
  );
}

const archived = recurring.filter((p) => !p.active);
if (archived.length) {
  console.log(`\n  (${archived.length} archived price(s) hidden — they cannot be used for new checkouts)`);
}

// Mirror the API's own resolution order so the output IS the answer.
console.log("\nWHAT THE API RESOLVES");
const ENV_KEYS = {
  studio_monthly: "STRIPE_PRICE_STUDIO_MONTHLY",
  studio_annual: "STRIPE_PRICE_STUDIO_ANNUAL",
  agency_monthly: "STRIPE_PRICE_AGENCY_MONTHLY",
  agency_annual: "STRIPE_PRICE_AGENCY_ANNUAL",
};
let missing = 0;
for (const slot of SLOTS) {
  const env = process.env[ENV_KEYS[slot]];
  if (env) {
    console.log(`  ${slot.padEnd(16)} ${env}  (pinned by ${ENV_KEYS[slot]})`);
    continue;
  }
  const tagged = recurring.find((p) => p.active && p.lookup_key === slot);
  if (tagged) {
    console.log(`  ${slot.padEnd(16)} ${tagged.id}  (lookup key)`);
    continue;
  }
  const [plan, period] = slot.split("_");
  const wantInterval = period === "annual" ? "year" : "month";
  const guesses = recurring.filter((p) => {
    if (!p.active || p.recurring.interval !== wantInterval) return false;
    const prod = typeof p.product === "object" && p.product ? p.product : null;
    if (!prod || prod.active === false || prod.deleted) return false;
    const name = (prod.name ?? "").toLowerCase();
    return prod.metadata?.plan?.toLowerCase() === plan || name.includes(plan);
  });
  missing++;
  if (!guesses.length) {
    console.log(`  ${slot.padEnd(16)} NOTHING — checkout for this plan returns 503 price_unavailable`);
  } else {
    const note = guesses.length > 1 ? `  AMBIGUOUS: ${guesses.length} candidates, newest wins` : "";
    console.log(`  ${slot.padEnd(16)} ${guesses[0].id}  (name guess)${note}`);
  }
}

if (missing) {
  console.log(
    `\n${missing} slot(s) have no lookup key and fall back to guessing by product name.` +
      `\nTag them so resolution is exact:\n\n  node stripe-setup.mjs --apply ` +
      SLOTS.map((s) => `${s}=price_…`).join(" ") +
      "\n"
  );
} else {
  console.log("\nEvery slot resolves by lookup key. Nothing to do.\n");
}
