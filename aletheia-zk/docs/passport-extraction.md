# Passport extraction (camera scan → normalized credential)

How a photographed passport page becomes a normalized credential. The MRZ parser (stage
15, day 17) and image/PDF input (stage 15, day 18) are implemented in
`packages/extraction`; the "Where extraction runs" and "Image and PDF input" sections below
record what shipped. The rest of this document is the normative target the code is held to.

The one sentence that governs this whole document: **extraction produces untrusted
candidate fields, never evidence.** A camera scan is pixels. OCR turns pixels into text.
No step in that chain is signed by anyone, so a credential built from it attests that an
image was uploaded and parsed, and nothing more. See `docs/trust-model.md`.

## Why the MRZ and not the printed page

A TD3 passport data page carries the same facts twice: the visual inspection zone (VIZ),
laid out for humans, and the machine-readable zone (MRZ), two 44-character lines of OCR-B
designed to be read by machines under bad conditions.

Extraction targets the MRZ. It is fixed-width, single-font, has a known character set,
and carries check digits. The VIZ is variable-layout, multi-font, often has a watermark
or hologram over it, and has no redundancy at all. Reading the MRZ is a solved problem;
reading the VIZ reliably is not.

The cost is that the MRZ does not contain every field. Most importantly it has **no date
of issue** — that is printed in the VIZ only. This does not matter, because `issuedAt` in
the credential means "when the Aletheia issuer attested this", not "when the government
printed the passport". See the field mapping below.

## Field mapping

TD3 line 2 positions, and where each lands in schema v1:

| MRZ field | Positions | Schema v1 field | Transformation |
|---|---|---|---|
| Passport number | 1-9 | — | validated, then consumed on-device to derive `documentKey`; never signed or stored as itself. See below |
| Check digit | 10 | — | validates the number |
| Nationality | 11-13 | `nationality` | alpha-3 → ISO 3166-1 numeric |
| Date of birth | 14-19 | `dateOfBirth` | `YYMMDD` → `YYYYMMDD`, century inferred |
| Check digit | 20 | — | validates the date of birth |
| Sex | 21 | — | not in schema v1 |
| Date of expiry | 22-27 | `expiryDate` | `YYMMDD` → `YYYYMMDD`, century inferred |
| Check digit | 28 | — | validates the expiry |
| Personal number | 29-42 | — | not in schema v1; often blank |
| Composite check | 44 | — | validates the line |

Three fields not from the document at all:

- `subject` — the holder's wallet address
- `credentialId` — 31 random bytes, generated per credential (see `docs/credential-schema.md`)
- `issuedAt` — the date the issuer signs, i.e. today

The MRZ's issuing state (line 1, positions 3-5) is deliberately dropped. It is usually
equal to nationality but not always, and schema v1 has one country field. Adding
`issuingState` would be a schema v2 change; there is no Phase 1 claim that needs it.

## Century inference

`YYMMDD` has no century, and getting this wrong silently breaks age claims by 100 years,
so the rule is fixed here rather than left to the parser.

**Expiry** is always `20YY`. A passport in circulation cannot have expired in the 1900s,
and the maximum validity period puts every real expiry comfortably inside this century.

**Date of birth** takes the interpretation that is not in the future relative to
`currentDate`: `20YY` if that date has already passed, otherwise `19YY`. This is correct
for everyone under 100.

For someone at or over 100 both readings are in the past and genuinely ambiguous.
Extraction must then report *ambiguous* and ask for confirmation. It must not pick the
likelier one — a wrong guess here produces a credential the issuer will happily sign and
that will prove a false age claim.

## Nationality codes

The MRZ carries an ICAO alpha-3 code; the schema carries ISO 3166-1 numeric. India is
`IND` → `356`. The mapping table is data, not logic, and belongs in `packages/credential`
alongside the date codec so that one module owns every encoding.

Some ICAO codes have no ISO numeric equivalent and must return *unsupported* rather than
a nearest match:

- `XXA`, `XXB`, `XXC`, `XXX` — stateless persons, refugees, and unspecified nationality
- `GBD`, `GBN`, `GBO`, `GBP`, `GBS` — British national subcategories
- `UNO`, `UNA`, `UNK` — United Nations travel documents

This is the stage-15 gate applied to a real case: an unsupported input says so and stops.

## Check digits are a misread detector, not evidence

The MRZ check digits use ICAO's weighted `7-3-1` modulus 10. They catch the failure mode
that actually matters for a camera scan: `0` read as `O`, `1` as `I`, `5` as `S`, or a
blurred digit. A failing check digit means *re-scan*, and extraction should say exactly
which field failed.

They establish nothing about authenticity. The algorithm is public and deterministic, so
anyone fabricating an MRZ computes valid check digits as a matter of course. A passing
check digit means the text was read correctly; it does not mean the passport is real.

## Passport number

The number is read and validated — format plus its check digit — and then, as itself,
**never leaves this layer**. It is not signed, not stored on any wire, and never a public
proof input. It is not a schema field: `Poseidon(8)` has no slot for it. Its one use is as
an input to `documentKey` (next section), a private on-device intermediate.

It is worth being clear about what proving anything over the number *directly* would buy,
which is less than it sounds. Proving "my document number has valid check digits" proves
nothing — the algorithm is public. Proving "my document number is *X*" discloses it. The
one genuinely valuable use — one person, one verification — is not built on the raw number
either; it is built on `documentKey` behind the issuer's secret salt, which is exactly the
mechanism `docs/credential-schema.md` describes (`identitySecret`, `identityNullifier`).

Validating the number is still worth doing, because a number that fails its check digit
is strong evidence the whole MRZ read badly, including the date of birth.

## Document key

`documentKey` is a stable field element identifying one physical passport, derived here
because this is the only layer that knows the document format. It is the input
`deriveIdentitySecret({ issuerSalt, documentKey })` expects, and
`identitySecret = Poseidon([issuerSalt, documentKey])` is what makes two credentials the
same issuer derives from the same passport share an `identityNullifier` within a context
(`docs/credential-schema.md`). `packages/extraction/src/document-key.ts` is the executable
form; four properties define it, and each is a stage-19 gate:

- **Deterministic.** The same passport, typed or scanned twice, yields the same key,
  because the input is the *normalized* candidate fields, not the raw glyphs. Two reads
  that both extract successfully agree by construction.
- **Collision-free across documents.** It hashes the four fields that together identify
  the booklet — issuing nationality, document number, date of birth, date of expiry: the
  tuple (number, DOB, expiry) ICAO itself derives the chip access key from, plus
  nationality to disambiguate a number reused across issuers. Two distinct passports would
  have to agree on all four to collide.
- **A field element.** A domain-separated SHA-256 digest reduced into the bn128 scalar
  field the same way every other 32-byte digest here is (`hashToField`, leading 31 bytes),
  so it is always canonical and non-zero.
- **On-device only.** The derivation is pure and offline. Because `issuerSalt` is the
  issuer's secret, the credential cannot be run backwards to the document, and two issuers
  derive unrelated secrets from the same passport.

Derivation runs **after** the mandatory review step, on the fields the holder confirmed —
not on unreviewed OCR — since extraction produces untrusted candidate fields. A renewed
passport is a different booklet (new number, new expiry) and derives a new `documentKey`,
consistent with `identitySecret` being stable only "across credentials the same issuer
derives from the same document".

## Expiry semantics

`expiryDate` in the credential is **the passport's expiry date**, read from the MRZ.

Consequences, all intended:

- Claim type 3 means "the holder has a travel document that is valid today", which is
  the claim a verifier actually wants.
- Every other claim inherits it. `CredentialClaimBase` enforces
  `expiryDate >= currentDate`, so an age proof already proves the passport is unexpired.
- An expired passport cannot produce a credential at all.
  `assertNormalizedCredential` rejects `expiryDate < issuedAt`, and `issuedAt` is today,
  so the issuer refuses to sign before any proof is attempted. The error surfaces at
  attestation time with a clear cause rather than as an unsatisfiable circuit.

Accepted risk: an Indian passport is valid for ten years (five for minors), so a
credential signed today stays usable for up to a decade on the strength of a single scan
that happened once. Extraction quality is not re-checked over that period, and neither is
whether the passport was subsequently revoked or reported lost. Phase 2 issuers that can
check revocation should shorten `expiryDate` to their own attestation window; the schema
already permits any date, so this is issuer policy, not a format change.

## Where extraction runs

Client-side only. The image never leaves the device, and no server sees the passport.

This preserves the separation `docs/trust-model.md` already relies on: extraction code
cannot sign, and the issuer cannot read documents. It also means the issuer signs values
the user confirmed rather than values it verified — which is the honest position for
Phase 1 and exactly why the issuer is labelled `mock-dev` on-chain.

The user reviews and corrects every extracted field before anything is signed. Extraction
saves typing; it is not an authority.

This shipped in the Day 20 holder flow (`packages/web`): extraction, `documentKey`
derivation, mock-dev signing and Groth16 proving all run in the browser, and the review
step is a mandatory gate before signing. A live run submitted a real Sepolia transaction
with the network tab showing only same-origin assets and RPC calldata — no passport field
in any request. See `packages/web/README.md`.

## Image and PDF input

The holder can hand extraction three things — the two MRZ lines typed in, a photo/scan
image, or a PDF — and all three converge on one parser. Each source is decoded to plain
text, the two 44-character MRZ lines are located in that text, and those lines go through
the same `parseTd3Mrz` the typed path uses. An image and a PDF of one passport therefore
reach byte-identical candidate fields to typing its MRZ; there is only ever one parser, so
there is only ever one set of rules for check digits, century inference and nationality.

A camera scan needs no separate path: the browser captures a frame as an image, and the
image path consumes it. What "image" means is encoded-image bytes.

Everything runs on the device, off the main thread. `packages/extraction` decodes both
sources with browser-capable libraries — pdf.js for the PDF text layer, a WebAssembly
Tesseract build with a committed MRZ-specific model for OCR — driven from a Web Worker so a
large file never freezes the UI. There is no server-side parser, and extraction issues no
network request at all: the OCR model and its wasm core are bundled and loaded from disk,
never a CDN. The gate for this is a test that severs every socket and `fetch` around the
extraction and asserts the fixture image and fixture PDF still reach the fields.

Four properties bound what a hostile or malformed file can do, because the file is
untrusted input in exactly the sense the MRZ text is:

- **PDF JavaScript is disabled.** pdf.js is never given its scripting layer, so a PDF's
  `OpenAction` and field scripts do not run, and `isEvalSupported` is off so pdf.js will
  not use `eval` for its own parsing either.
- **A byte cap and a page cap** (`MAX_DOCUMENT_BYTES`, `MAX_PDF_PAGES`) refuse a file large
  enough to exhaust memory or a PDF with enough pages to exhaust CPU, before decoding.
- **Extracted text is never evaluated.** The strings the decoders return are treated as
  data — found and parsed — and never passed to `eval`, `Function`, or a template.

The OCR fixture is a clean, high-contrast render of the MRZ, which is the best case a
cropped data page or a good scan approximates; OCR is only ever exact on an image it can
actually read, so the fixture is a legitimate clean scan rather than a shortcut. The model
is `mrz.traineddata` from the DoubangoTelecom `tesseractMRZ` project (BSD-3-Clause),
redistributed unmodified with its licence under `packages/extraction/assets`.

## What this cannot do, and the way out

No amount of OCR makes a photograph trustworthy. The passport data page is not signed;
the chip inside it is.

An ICAO 9303 e-passport carries a Document Security Object signed by the issuing
country's document signer certificate, chaining to a CSCA in the ICAO master list. That
is a real government signature over the same data groups the MRZ prints. The key that
unlocks the chip over NFC is derived from three MRZ fields — passport number, date of
birth, date of expiry — which is precisely what this extraction step produces.

So MRZ reading is not throwaway work; it is the prerequisite for the real thing. The two
ways to consume the chip data map onto the paths already in
`docs/phase2-digilocker.md`: an issuer that verifies the Document Security Object
off-chain and re-attests (Path A, circuits and contracts unchanged), or verification of
the government signature inside the circuit (Path B, orders of magnitude more
constraints). Path A is the realistic next step.
