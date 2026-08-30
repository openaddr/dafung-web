// #50 patchwiki 管线的纯函数单测(不发网络请求;网络路径由端到端真跑覆盖)。
import { describe, it, expect } from "bun:test";
import { classifyWikiUrl, originalFromPatchwikiThumb, pngSize, fileBaseName } from "../scripts/fetch-asset";

describe("classifyWikiUrl(输入 URL 分类)", () => {
  it("curid File 页 → filepage + pageid", () => {
    expect(classifyWikiUrl("https://wiki.biligame.com/sgs/index.php?curid=2199")).toEqual({
      kind: "filepage",
      pageid: 2199,
    });
  });

  it("index.php?title= 形式 → filepage + 标题(decode + 下划线还原空格)", () => {
    const url =
      "https://wiki.biligame.com/sgs/index.php?title=%E6%96%87%E4%BB%B6:%E5%91%A8%E7%91%9C-%E7%BB%8F%E5%85%B8%E5%BD%A2%E8%B1%A1.png";
    expect(classifyWikiUrl(url)).toEqual({ kind: "filepage", title: "文件:周瑜-经典形象.png" });
  });

  it("路径式 File 页(下划线编码)→ filepage + 标题", () => {
    const url = "https://wiki.biligame.com/sgs/%E6%96%87%E4%BB%B6:%E5%91%A8%E7%91%9C-%E7%BB%8F%E5%85%B8%E5%BD%A2%E8%B1%A1.png";
    expect(classifyWikiUrl(url)).toEqual({ kind: "filepage", title: "文件:周瑜-经典形象.png" });
  });

  it("patchwiki 原图直链 → image(原样)", () => {
    const url = "https://patchwiki.biligame.com/images/sgs/0/0a/dlzu3clu0o9icnzbhg3o97jeg5l9u1a.png";
    expect(classifyWikiUrl(url)).toEqual({ kind: "image", url });
  });

  it("patchwiki 缩略图直链 → image(还原为原图)", () => {
    const thumb =
      "https://patchwiki.biligame.com/images/sgs/thumb/6/63/ivv8m0jgkizo5vn3pio6et2o8alnbsz.png/452px-%E5%91%A8%E7%91%9C-%E7%BB%8F%E5%85%B8%E5%BD%A2%E8%B1%A1.png";
    expect(classifyWikiUrl(thumb)).toEqual({
      kind: "image",
      url: "https://patchwiki.biligame.com/images/sgs/6/63/ivv8m0jgkizo5vn3pio6et2o8alnbsz.png",
    });
  });

  it("patchwiki 站点资源(非 /images/)抛错", () => {
    expect(() => classifyWikiUrl("https://patchwiki.biligame.com/resources/assets/images/logo/logo_sgs.png")).toThrow(/\/images\//);
  });

  it("裸 index.php(无 curid/title/页面标题)抛错", () => {
    expect(() => classifyWikiUrl("https://wiki.biligame.com/sgs/index.php")).toThrow(/既无 curid 也无页面标题/);
  });

  it("wiki 站根路径抛错", () => {
    expect(() => classifyWikiUrl("https://wiki.biligame.com/sgs/")).toThrow(/既无 curid 也无页面标题/);
  });

  it("其他站点抛错", () => {
    expect(() => classifyWikiUrl("https://example.com/images/a.png")).toThrow(/不支持的来源/);
  });

  it("非 URL 字符串抛错", () => {
    expect(() => classifyWikiUrl("周瑜-经典形象")).toThrow(/不是合法 URL/);
  });

  it("curid 非正整数抛错", () => {
    expect(() => classifyWikiUrl("https://wiki.biligame.com/sgs/index.php?curid=12abc")).toThrow(/curid/);
  });
});

describe("originalFromPatchwikiThumb(缩略图 → 原图)", () => {
  it("标准 <N>px- 缩略图还原原图", () => {
    expect(
      originalFromPatchwikiThumb(
        "https://patchwiki.biligame.com/images/sgs/thumb/6/63/ivv8m0jgkizo5vn3pio6et2o8alnbsz.png/90px-%E5%91%A8%E7%91%9C.png",
      ),
    ).toBe("https://patchwiki.biligame.com/images/sgs/6/63/ivv8m0jgkizo5vn3pio6et2o8alnbsz.png");
  });

  it("非缩略图直链原样返回", () => {
    const url = "https://patchwiki.biligame.com/images/sgs/0/05/1jumtaie3e4htkd6x711g9ak88js3py.png";
    expect(originalFromPatchwikiThumb(url)).toBe(url);
  });
});

describe("pngSize(PNG IHDR 校验)", () => {
  function makePng(width: number, height: number): Buffer {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  }

  it("读出 IHDR 尺寸(574×761 口径)", () => {
    expect(pngSize(makePng(574, 761))).toEqual({ width: 574, height: 761 });
  });

  it("非 PNG 签名抛错", () => {
    expect(() => pngSize(Buffer.from("GIF89a" + "0".repeat(24)))).toThrow(/PNG/);
  });

  it("截断的 PNG 抛错", () => {
    expect(() => pngSize(Buffer.from([0x89, 0x50]))).toThrow(/PNG/);
  });
});

describe("fileBaseName(File 页标题 → 素材名)", () => {
  it("剥掉 文件: 前缀与扩展名", () => {
    expect(fileBaseName("文件:司马懿-经典形象.png")).toBe("司马懿-经典形象");
  });

  it("非 File 前缀只剥扩展名", () => {
    expect(fileBaseName("周瑜-经典形象.png")).toBe("周瑜-经典形象");
  });
});
