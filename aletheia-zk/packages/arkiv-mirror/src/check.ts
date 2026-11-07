/** Reads the Arkiv mirror back through the same QueryClient interface the web app uses. */
import { createArkivQueryClient } from "../../query/src/arkiv.ts";

const c = createArkivQueryClient({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
const meta = await c.meta();
console.log("meta:", meta);
const recent = await c.recentVerifications({ first: 3 });
console.log("recent:", recent.data.map((v) => ({ id: v.id.slice(0, 12), subject: v.subject.id, claimType: v.claimType, issuer: v.issuer.label, active: v.issuer.active, block: v.blockNumber })));
const subject = recent.data[0]!.subject.id;
const profile = await c.profile(subject);
console.log("profile", subject, "→", profile.data?.verifications.length, "verifications");
const state = await c.verificationState(recent.data[0]!.id, { policy: { maxVerificationAgeSeconds: 10 ** 9 } });
console.log("state:", state.status ?? state);
console.log("unknown address profile:", (await c.profile("0x000000000000000000000000000000000000dEaD")).data);
