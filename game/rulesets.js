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
      '四人，每人16张，庄家17张',
      '每局翻两张牌做财神，翻出一样时只有一种财神',
      '已接通花牌、双财神、补花和房间入口，台数和完整平阳结算继续细化中',
    ],
  },
};

function normalizeRuleset(ruleset) {
  return RULESETS[ruleset]?.id || 'ruian';
}

module.exports = { RULESETS, normalizeRuleset };
