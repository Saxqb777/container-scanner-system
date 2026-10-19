import { NextResponse } from "next/server";
import { readPhoto } from "@/lib/vision";
import { checkContainer } from "@/lib/iso6346";
import { normalizeSeal } from "@/lib/seal";
import { fail, serverError } from "@/lib/http";

export const maxDuration = 60;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export async function POST(req: Request) {
  const { image } = (await req.json().catch(() => ({}))) as { image?: string };
  const match = image?.match(DATA_URL);
  if (!match) return fail("Send the photo as a JPEG, PNG or WebP image");

  try {
    const reading = await readPhoto(match[2], match[1] as "image/jpeg" | "image/png" | "image/webp");
    const container = reading.container_number ? checkContainer(reading.container_number) : null;
    return NextResponse.json({
      kind: reading.kind,
      container: container?.value ?? null,
      containerValid: container?.ok ?? false,
      seal: reading.seal_number ? normalizeSeal(reading.seal_number) : null,
      uncertain: reading.uncertain,
      note: reading.note,
    });
  } catch (err) {
    return serverError(err);
  }
}
