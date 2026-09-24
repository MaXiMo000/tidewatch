import { afterEach, describe, expect, it } from "vitest";
import { prettyName, setDisplayNames } from "./copy";

describe("prettyName", () => {
  afterEach(() => setDisplayNames([]));

  it("title-cases ids in demo mode", () => {
    expect(prettyName("api")).toBe("API");
    expect(prettyName("gateway")).toBe("Gateway");
  });

  it("uses live display names for apps and their dependency islands", () => {
    setDisplayNames([{ id: "aninest", name: "AniNest" }]);
    expect(prettyName("aninest")).toBe("AniNest");
    expect(prettyName("aninest-db")).toBe("AniNest DB");
    expect(prettyName("aninest-anime-api")).toBe("AniNest Anime API");
    expect(prettyName("internet")).toBe("Internet");
  });
});
