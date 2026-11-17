import { SPECIALTY_RULES, renderSpecialtyRules } from './specialty-rules.js';
export const SPECIALTIES=Object.freeze(Object.fromEntries(Object.entries(SPECIALTY_RULES).map(([topic,policy])=>[topic,Object.freeze({name:policy.name,prompt:renderSpecialtyRules(topic)})])));

const majors=['愚者','魔术师','女祭司','女皇','皇帝','教皇','恋人','战车','力量','隐者','命运之轮','正义','倒吊人','死神','节制','恶魔','高塔','星星','月亮','太阳','审判','世界'];
const ranks=['王牌','二','三','四','五','六','七','八','九','十','侍从','骑士','王后','国王'];
const deck=[...majors,...['权杖','圣杯','宝剑','星币'].flatMap(suit=>ranks.map(rank=>suit+rank))];
function randomIndex(size){
  const ceiling=Math.floor(0x100000000/size)*size;
  let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=ceiling);
  return n%size;
}
export function specialtyContext(topic){
  if(topic!=='tarot')return {};
  const remaining=[...deck];
  return {cards:['状况','阻碍','建议'].map(position=>({position,name:remaining.splice(randomIndex(remaining.length),1)[0],reversed:randomIndex(2)===1}))};
}
export function specialtyPrompt(topic,context={}){
  const specialty=SPECIALTIES[topic];
  if(!specialty)return null;
  const cards=topic==='tarot'&&Array.isArray(context.cards)?'\n本会话固定牌阵：'+context.cards.map(c=>`${c.position}：${c.name}（${c.reversed?'逆位':'正位'}）`).join('；'):'';
  return specialty.prompt+cards;
}
