import { CtaPreset } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type CtaPresetKey = "spotify" | "follow" | "share" | "request" | "support";

export const CTA_PRESET_ORDER: CtaPresetKey[] = ["spotify", "follow", "share", "request", "support"];

type DefaultPreset = {
  key: CtaPresetKey;
  label: string;
  title: string;
  subtitle: string;
  accentColor: string;
};

const DEFAULT_PRESETS: DefaultPreset[] = [
  {
    key: "spotify",
    label: "Spotify CTA",
    title: "Listen on Spotify",
    subtitle: 'Search "{artist}" on Spotify',
    accentColor: "#22c55e",
  },
  {
    key: "follow",
    label: "Follow CTA",
    title: "Follow For More",
    subtitle: "Tap follow so you never miss the next live set.",
    accentColor: "#38bdf8",
  },
  {
    key: "share",
    label: "Share CTA",
    title: "Share This Live",
    subtitle: "Send this stream to one friend right now.",
    accentColor: "#f59e0b",
  },
  {
    key: "request",
    label: "Song Request CTA",
    title: "Song Requests Open",
    subtitle: "Drop your request in chat and I will queue it.",
    accentColor: "#22c55e",
  },
  {
    key: "support",
    label: "Support CTA",
    title: "Support The Music",
    subtitle: "Gifts and shares help keep these lives going.",
    accentColor: "#f97316",
  },
];

function sanitizeText(value: string | null | undefined, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeAccent(value: string | null | undefined, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : fallback;
}

function defaultByKey(key: CtaPresetKey): DefaultPreset {
  const preset = DEFAULT_PRESETS.find((item) => item.key === key);
  if (!preset) {
    throw new Error(`Missing default CTA preset: ${key}`);
  }
  return preset;
}

function sortByPresetOrder(presets: CtaPreset[]): CtaPreset[] {
  const order = new Map<string, number>(CTA_PRESET_ORDER.map((key, index) => [key, index]));
  return [...presets].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}

async function ensureDefaultPresets(): Promise<void> {
  for (const preset of DEFAULT_PRESETS) {
    await prisma.ctaPreset.upsert({
      where: { key: preset.key },
      update: {},
      create: {
        key: preset.key,
        label: preset.label,
        title: preset.title,
        subtitle: preset.subtitle,
        accentColor: preset.accentColor,
      },
    });
  }
}

export async function getCtaPresets(): Promise<CtaPreset[]> {
  await ensureDefaultPresets();
  const presets = await prisma.ctaPreset.findMany();
  return sortByPresetOrder(presets);
}

type UpdateCtaPresetInput = {
  key: CtaPresetKey;
  label?: string;
  title?: string;
  subtitle?: string;
  accentColor?: string;
};

export async function updateCtaPreset(input: UpdateCtaPresetInput): Promise<CtaPreset> {
  const defaults = defaultByKey(input.key);
  const hasSubtitle = Object.prototype.hasOwnProperty.call(input, "subtitle");

  const label = sanitizeText(input.label, 40);
  const title = sanitizeText(input.title, 140);
  const subtitle = sanitizeText(input.subtitle, 320);
  const accentColor = sanitizeAccent(input.accentColor, defaults.accentColor);

  return prisma.ctaPreset.upsert({
    where: { key: input.key },
    update: {
      ...(label ? { label } : {}),
      ...(title ? { title } : {}),
      ...(hasSubtitle ? { subtitle } : {}),
      accentColor,
    },
    create: {
      key: input.key,
      label: label || defaults.label,
      title: title || defaults.title,
      subtitle: subtitle || defaults.subtitle,
      accentColor,
    },
  });
}
