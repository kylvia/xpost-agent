"use strict";

const TOPICS = [
  "自动化",
  "现金流",
  "行动力",
  "边界",
  "睡眠",
  "职场",
  "信息差",
  "复盘",
];

const REALIST_TEMPLATES = [
  (topic) => `成年人做${topic}，先别幻想它改变命运。\n\n它只会放大你的现状：\n流程乱，自动化就是加速出错；\n判断差，工具越强越会误伤；\n没有复盘，忙一周也只是原地打转。\n\n先把输入、边界和反馈做好。\n工具不是杠杆，正确的流程才是。`,
  (topic) => `${topic}这件事，最怕的不是慢，是假装自己在推进。\n\n真正有效的东西通常很朴素：\n每天有输入；\n每次有输出；\n失败能记录；\n下次能少错一点。\n\n别追求仪式感。\n成年人要的是系统，不是感动自己。`,
  (topic) => `一个朴素的规矩：\n\n任何会持续消耗睡眠、现金流、情绪和时间的${topic}，都要谨慎。\n\n短期看是机会，长期看可能是负债。\n能赚钱也要看代价。\n能增长也要看反噬。\n\n别只问能不能做，先问做完谁承担后果。`,
];

function pick(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function createDraft(options = {}) {
  const topic = options.topic && options.topic !== "random" ? options.topic : pick(TOPICS);
  const template = pick(REALIST_TEMPLATES);
  return {
    style: options.style || "realist",
    topic,
    text: template(topic),
  };
}

module.exports = { createDraft, TOPICS };
