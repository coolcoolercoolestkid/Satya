import { describe, expect, it } from "vitest";
import { credentialFindings, readCredential, type ManifestStoreLike } from "../src/index.js";

const store = (digitalSourceType: string | undefined, status: string[] = [], state = "Valid"): ManifestStoreLike => ({
  active_manifest: "m1",
  validation_state: state,
  validation_status: status.map((code) => ({ code })),
  manifests: {
    m1: {
      claim_generator_info: [{ name: "Test App" }],
      signature_info: { issuer: "Test Signer" },
      assertions: [{ label: "c2pa.actions.v2", data: { actions: [{ action: "c2pa.created", digitalSourceType }] } }],
    },
  },
});
const T = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const titles = (s: ManifestStoreLike | null) => credentialFindings([readCredential("https://x.example/a.jpg", s)!].filter(Boolean), 1).map((f) => `${f.severity}: ${f.title}`);

describe("Content Credentials", () => {
  it("tells generative AI apart from camera photos and plain computer graphics", () => {
    expect(titles(store(`${T}trainedAlgorithmicMedia`))[0]).toBe('info: Image "a.jpg" was made by AI');
    expect(titles(store(`${T}compositeWithTrainedAlgorithmicMedia`))[0]).toBe('info: Image "a.jpg" was edited with AI');
    expect(titles(store(`${T}digitalCapture`))[0]).toBe('good: Image "a.jpg" is a camera photo');
    expect(titles(store(`${T}algorithmicMedia`))[0]).toBe('info: Image "a.jpg" was drawn by a computer program, not AI');
  });
  it("flags labels that don't match the image, and notes untrusted signers", () => {
    expect(titles(store(`${T}digitalCapture`, ["claimSignature.mismatch"], "Invalid"))[0]).toMatch(/^warning: .*broken Content Credentials/);
    const f = credentialFindings([readCredential("https://x.example/a.jpg", store(`${T}trainedAlgorithmicMedia`, ["signingCredential.untrusted"]))!], 1);
    expect(f[0]!.detail).toMatch(/isn't on the official C2PA trust list/);
  });
  it("says nothing about images without a label", () => {
    expect(readCredential("https://x.example/a.jpg", null)).toBeUndefined();
    expect(titles(null)).toEqual(["info: Checked 1 image for Content Credentials: 0 had them"]);
  });
});
