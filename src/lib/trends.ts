import * as cheerio from "cheerio";

export type TrendSignals = {
  topSounds: Array<{
    title: string;
    author?: string;
    link?: string;
    relatedVideoIds: string[];
  }>;
  topHashtags: Array<{
    hashtag: string;
    videoViews?: number;
    publishCnt?: number;
  }>;
  warnings: string[];
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function fetchTrendSignals(): Promise<TrendSignals> {
  const warnings: string[] = [];
  let topSounds: TrendSignals["topSounds"] = [];
  let topHashtags: TrendSignals["topHashtags"] = [];

  try {
    const musicHtml = await (
      await fetch("https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en", {
        headers: HEADERS,
        cache: "no-store",
      })
    ).text();
    const $music = cheerio.load(musicHtml);
    const musicData = safeJsonParse<{
      props?: {
        pageProps?: {
          data?: {
            soundList?: Array<{
              title?: string;
              author?: string;
              link?: string;
              relatedItems?: Array<{ itemId?: string }>;
            }>;
          };
        };
      };
    }>($music("#__NEXT_DATA__").html());

    const sounds = musicData?.props?.pageProps?.data?.soundList ?? [];
    topSounds = sounds.slice(0, 8).map((sound) => ({
      title: sound.title ?? "unknown",
      author: sound.author,
      link: sound.link,
      relatedVideoIds: (sound.relatedItems ?? [])
        .map((item) => item.itemId ?? "")
        .filter((itemId) => Boolean(itemId)),
    }));
  } catch (error) {
    warnings.push(
      `Creative Center music trends unavailable: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    const hashtagHtml = await (
      await fetch("https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en", {
        headers: HEADERS,
        cache: "no-store",
      })
    ).text();
    const $hash = cheerio.load(hashtagHtml);
    const hashtagData = safeJsonParse<{
      props?: {
        pageProps?: {
          dehydratedState?: {
            queries?: Array<{
              queryKey?: unknown[];
              state?: {
                data?: {
                  pages?: Array<{
                    list?: Array<{
                      hashtagName?: string;
                      videoViews?: number;
                      publishCnt?: number;
                    }>;
                  }>;
                };
              };
            }>;
          };
        };
      };
    }>($hash("#__NEXT_DATA__").html());

    const listQuery = (hashtagData?.props?.pageProps?.dehydratedState?.queries ?? []).find((query) =>
      JSON.stringify(query.queryKey ?? []).includes('"hashtag","list"')
    );
    const list = listQuery?.state?.data?.pages?.[0]?.list ?? [];
    topHashtags = list.slice(0, 12).map((tag) => ({
      hashtag: tag.hashtagName ?? "unknown",
      videoViews: tag.videoViews,
      publishCnt: tag.publishCnt,
    }));
  } catch (error) {
    warnings.push(
      `Creative Center hashtag trends unavailable: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  return { topSounds, topHashtags, warnings };
}
