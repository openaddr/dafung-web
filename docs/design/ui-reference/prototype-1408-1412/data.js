const data = {
  "fire": {
    "id": "火烧连营",
    "copies": 2,
    "tags": [
      "攻"
    ],
    "targetDomain": "one-city",
    "text": "火烧营寨:指定任意一座城为火源,对此城及其前方距离 1、2 格上的城各造成 1 点火焰伤害;无主城不受火焰伤害(作火源则自身免伤),己方城照烧。",
    "effect": {
      "kind": "fireWall",
      "damage": 1
    },
    "ink": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 70\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><g opacity=\"0.12\" fill=\"var(--fam)\" stroke=\"none\"><circle cx=\"12\" cy=\"16\" r=\"1.1\"></circle><circle cx=\"18\" cy=\"30\" r=\"0.9\"></circle><circle cx=\"10\" cy=\"44\" r=\"1.2\"></circle><circle cx=\"16\" cy=\"57\" r=\"0.8\"></circle><circle cx=\"88\" cy=\"14\" r=\"1.2\"></circle><circle cx=\"84\" cy=\"28\" r=\"0.9\"></circle><circle cx=\"92\" cy=\"42\" r=\"1.1\"></circle><circle cx=\"86\" cy=\"56\" r=\"0.8\"></circle></g><path d=\"M50 8 C44 18 56 22 52 32 C62 26 62 16 72 12 C68 24 80 32 74 44 C70 54 60 60 48 60 C34 60 26 50 28 40 C29 32 34 28 36 20 C40 26 46 26 46 20 C46 15 48 11 50 8\" stroke-width=\"3.2\"></path><path d=\"M50 58 C44 52 44 45 50 39 C56 45 56 52 50 58\" stroke-width=\"2\"></path><path d=\"M32 64 Q50 68 68 64\" stroke-width=\"1.9\"></path></svg>"
  },
  "seal": {
    "id": "seal",
    "name": "传国玉玺",
    "level": 10,
    "count": 1,
    "desc": "受命于天,既寿永昌",
    "image": "/assets/treasures/treasure-seal.webp",
    "price": "3000 两"
  },
  "boat": {
    "id": "携民渡江",
    "tier": "中性",
    "tags": [
      "银两",
      "声望"
    ],
    "weight": 1,
    "text": "流民数百拦江哭告,愿随你渡江避祸。安置他们需费银 100 两,但民心所向,声望大增;亦可径自过江,不相闻问。",
    "choices": [
      {
        "text": "携民渡江(费银 100 两,声望 +10)",
        "repDelta": 10,
        "effect": {
          "kind": "cash",
          "delta": -100
        }
      },
      {
        "text": "径自过江(无事发生)",
        "repDelta": 0
      }
    ],
    "ink": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 100 70\" aria-hidden=\"true\"><g opacity=\"0.11\"><path d=\"M4 60 Q28 56 52 59 Q76 62 96 58\" stroke-width=\"1.2\"></path></g><path d=\"M17 42 C13 33 23 27 32 30 C35 21 48 18 55 25 C62 19 74 22 77 30 C85 31 88 40 81 44 C76 46 71 46 68 45\" stroke-width=\"3.2\"></path><path d=\"M33 36 C31 30 40 28 42 34 C43 38 38 40 35 38\" stroke-width=\"1.9\"></path><path d=\"M22 56 Q48 61 76 55\" stroke-width=\"2.4\"></path><path d=\"M34 64 Q54 67 72 63\" stroke-width=\"1.4\"></path></svg>"
  },
  "neighbors": [
    {
      "id": "散财消灾",
      "tier": "中性",
      "tags": [
        "银两",
        "声望"
      ],
      "weight": 1,
      "text": "境内灾荒,饿殍遍野。开仓赈济需 130 两,可换百姓交口称颂;若充耳不闻,亦无人怪罪。",
      "choices": [
        {
          "text": "开仓赈济(费银 130 两,声望 +8)",
          "repDelta": 8,
          "effect": {
            "kind": "cash",
            "delta": -130
          }
        },
        {
          "text": "充耳不闻(无事发生)",
          "repDelta": 0
        }
      ]
    },
    {
      "id": "以宝换贤",
      "tier": "中性",
      "tags": [
        "珍宝",
        "名将"
      ],
      "weight": 0.8,
      "text": "名将遣使密告:愿以两件随身珍宝相赠,只求帐下效力。收下珍宝,名将即刻来投。",
      "choices": [
        {
          "text": "以两件珍宝换 1 名将",
          "repDelta": 0,
          "effect": {
            "kind": "grantHero",
            "fallbackCash": 0
          },
          "treasureCost": 2
        },
        {
          "text": "婉言相拒(无事发生)",
          "repDelta": 0
        }
      ]
    },
    {
      "id": "结盟互市",
      "tier": "中性",
      "tags": [
        "银两",
        "玩家"
      ],
      "weight": 0.8,
      "text": "邻镇诸侯遣使叩门:愿共设集市、通商互市。你与随机对手各得 100 两,银子皆由国库出——使团已替你在盟书上落了印。",
      "choices": [
        {
          "text": "结盟互市(你与随机对手各 +100 两,国库出)",
          "repDelta": 0,
          "effect": {
            "kind": "trade",
            "amount": 100
          }
        }
      ]
    }
  ],
  "rows": [
    {
      "id": "doudai",
      "name": "豆袋",
      "level": 1,
      "count": 2,
      "desc": "云长落难时贩豆的袋子",
      "image": "/assets/treasures/treasure-doudai.webp",
      "price": "100 两"
    },
    {
      "id": "duanxian",
      "name": "断弦琴",
      "level": 8,
      "count": 1,
      "desc": "空城城头武侯抚琴的那张琴",
      "image": "/assets/treasures/treasure-duanxian.webp",
      "price": "1600 两"
    },
    {
      "id": "edict",
      "name": "带血的诏书",
      "level": 9,
      "count": 1,
      "desc": "衣带诏,董承受命",
      "image": "/assets/treasures/treasure-edict.webp",
      "price": "2200 两"
    },
    {
      "id": "seal",
      "name": "传国玉玺",
      "level": 10,
      "count": 1,
      "desc": "受命于天,既寿永昌",
      "image": "/assets/treasures/treasure-seal.webp",
      "price": "3000 两"
    }
  ],
  "mapList": [
    {
      "id": "guanzhong",
      "name": "关中图",
      "file": "guanzhong.json",
      "desc": "4×7 满格螺旋小盘:28 城缩域快局,城距疏朗城池更大,长安洛阳相邻闭环、全环纯正交零对角",
      "tileCount": 28,
      "targetNetWorth": 30000,
      "target": "30000 两"
    },
    {
      "id": "zhongyuan",
      "name": "中原争霸",
      "file": "zhongyuan.json",
      "desc": "8 城小环,快节奏短局,适合 2 人速战",
      "tileCount": 8,
      "targetNetWorth": 30000,
      "target": "30000 两"
    }
  ],
  "version": "2026.11.63"
};
