import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const ReadingSchema = z.object({
  kind: z.enum(["container", "seal", "unclear"]),
  container_number: z.string().nullable(),
  seal_number: z.string().nullable(),
  uncertain: z.boolean(),
  note: z.string(),
});

export type Reading = z.infer<typeof ReadingSchema>;

const PROMPT = `This photo is from a container yard. It shows either the door of a shipping container or a container seal (bolt seal, cable seal, plastic seal).

If it shows a container: read the ISO 6346 container number printed on the door, usually top right. It is 4 letters (owner code ending in U, J, Z or R), 6 digits, then a check digit that is often inside a box. Return all 11 characters with no spaces, for example MRSU4985257. Ignore the size/type code below it (such as 45G1), weights, truck plates and handwriting.

If it shows a seal: read the seal's serial number exactly as printed or engraved, keeping any letters and leading zeros. Ignore the brand or company name.

Rules:
- Never guess a character. If any character is blurred, hidden or ambiguous, still give your best reading but set uncertain to true and say which character in note.
- If the photo shows neither, or the number cannot be read, use kind "unclear" and null numbers.
- note is one short plain sentence, or empty when there is nothing to flag.`;

let client: Anthropic | null = null;

export async function readPhoto(base64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<Reading> {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(ReadingSchema) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { kind: "unclear", container_number: null, seal_number: null, uncertain: true, note: "Could not read this photo." };
  }
  return response.parsed_output;
}
