'use strict';

const RULESETS = {
  ruian: {
    id: 'ruian',
    name: '瑞安麻将',
    implemented: true,
  },
  pingyang_taipao: {
    id: 'pingyang_taipao',
    name: '平阳台炮',
    implemented: true,
    notes: [
      '四人玩法，每人16张，庄家17张。',
      '每局翻两张牌做财神，翻出相同牌时只有一种财神。',
      '支持花牌/白板补牌、13台起翻、30台双翻、海底流局和人工结算。',
    ],
  },
};

function normalizeRuleset(ruleset) {
  return RULESETS[ruleset]?.id || 'ruian';
}

module.exports = { RULESETS, normalizeRuleset };
