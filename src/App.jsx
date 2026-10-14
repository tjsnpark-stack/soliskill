import React, { useState, useMemo, useEffect } from "react";
import ROSTER from "./roster.json"; // 실제 근무자 명단 기반 직원 데이터 (정직원, 팀 기반 스킬 자동 생성)
import ORGTREE from "./orgtree.json"; // 실제 조직도 트리 (대표이사→총괄/지사→그룹/본부→팀→사람, 협력인력 포함)

const STORAGE_KEY = "skillmap.emps.v10";
const SAVED_ID_KEY = "skillmap.savedId";   // 아이디 저장
const AUTH_KEY = "skillmap.auth";          // 자동 로그인(세션 유지)
const THEME_KEY = "skillmap.theme";        // 다크/라이트 테마 (기본 라이트)
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// 구식 edu[]/proj[] 텍스트를 역량 개발(activities)로 병합 — 중복은 제외
const R177_PORTFOLIO = "https://tjsnpark-stack.github.io/portfolio/";
const R177_GITHUB = "https://github.com/tjsnpark-stack";
function migrateEmp(e) {
  const acts = [...(e.activities || [])];
  const has = (title) => acts.some((a) => a.title === title);
  (e.edu || []).forEach((t) => { if (t && !has(t)) acts.push({ type: /자격|기사|증$/.test(t) ? "자격증" : "교육", title: t, date: "", skills: [] }); });
  (e.proj || []).forEach((t) => { if (t && !has(t)) acts.push({ type: "프로젝트", title: t, date: "", skills: [] }); });
  const email = e.id === "R177" ? "tjsn0610@solideos.com" : e.email;
  // 박선우 포트폴리오: 예전 자리표시 링크(behance)를 실제 포트폴리오 주소로 — 이미 저장된 데이터에도 적용
  const portfolio = e.id === "R177"
    ? (e.portfolio || []).map((p) => (p.kind !== "link" ? p
      : /behance\.net/.test(p.url || "") ? { ...p, title: "박선우 포트폴리오", url: R177_PORTFOLIO }
      : /^https:\/\/github\.com\/?$/.test(p.url || "") ? { ...p, url: R177_GITHUB } : p))
    : e.portfolio;
  // 이전 버전에서 중복 저장된 스킬 정리 — 남아 있으면 목록 렌더 시 React key가 충돌한다
  return { ...e, activities: acts, email, portfolio, skills: dedupeBy(e.skills || [], (s) => s[0]) };
}
// 경영진 시드 스킬 보정(사장 Node.js Lv5 등 어색한 자동생성분) — 이미 저장된 데이터에도 적용.
// 시드와 똑같은 항목(Lv5·프로젝트검증)만 바꾸므로, 이후 직접 추가·성장한 스킬은 건드리지 않는다.
const EXEC_FIX = {
  R131: { drop: ["Node.js"], add: [["공공SI 도메인", 5, "도메인", "프로젝트검증"], ["제안서작성", 4, "기획/PM", "프로젝트검증"]] },
  R221: { drop: ["Oracle", "Python"], add: [["공공SI 도메인", 5, "도메인", "프로젝트검증"], ["제안서작성", 4, "기획/PM", "프로젝트검증"]] },
};
// "시스템 연계" 역량 시드(연계 업무 팀) — 이미 저장된 데이터에도 없으면 추가(있으면 그대로 둠)
const LINK_SEED = {
  R063: [5, "프로젝트검증"], R065: [4, "자동추출"], R069: [3, "자동추출"], R114: [4, "프로젝트검증"], R056: [4, "자동추출"],
  R057: [3, "자동추출"], R055: [3, "자동추출"], R097: [4, "프로젝트검증"], R204: [3, "자동추출"],
};
const LINK_ACTS = Object.fromEntries(ROSTER.filter((e) => LINK_SEED[e.id]).map((e) => [e.id, (e.activities || []).filter((a) => (a.skills || []).includes("시스템 연계"))]));
function addLinkSeed(e) {
  const seed = LINK_SEED[e.id];
  if (!seed) return e;
  const skills = e.skills.some((s) => skEq(s[0], "시스템 연계")) ? e.skills : [...e.skills, ["시스템 연계", seed[0], "백엔드", seed[1]]];
  const acts = [...(e.activities || [])];
  (LINK_ACTS[e.id] || []).forEach((a) => { if (!acts.some((x) => x.title === a.title)) acts.push(a); });
  return { ...e, skills, activities: acts };
}
function fixExecSkills(e) {
  const f = EXEC_FIX[e.id];
  if (!f || !e.skills.some((s) => f.drop.includes(s[0]) && s[1] === 5 && s[3] === "프로젝트검증")) return e;
  const skills = e.skills.filter((s) => !(f.drop.includes(s[0]) && s[1] === 5 && s[3] === "프로젝트검증"));
  f.add.forEach((a) => { if (!skills.some((s) => skEq(s[0], a[0]))) skills.push([...a]); });
  return { ...e, skills };
}
function loadEmps() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const base = raw ? JSON.parse(raw) : SEED;
    const list = Array.isArray(base) && base.length ? base : SEED;
    return list.map(migrateEmp).map(fixExecSkills).map(addLinkSeed);
  } catch {
    return SEED.map(migrateEmp);
  }
}

const CATS = ["프론트엔드", "백엔드", "디자인", "기획/PM", "데이터", "AI", "도메인"];
const STRENGTHS = ["협업", "문제해결", "자기계발", "배려", "적극성", "업무성과"];
// 적합도 공통 기준(화면에 그대로 공개): 보유 기술 = base + 숙련도×perLv, 강점 일치 = strength, 미보유 = 0 → 항목 평균
// 초기값은 "보유 여부를 숙련도보다 크게 본다"는 원칙으로 정한 값(실증 근거 아님) — 관리자가 조직 합의에 맞춰 조정한다.
const DEFAULT_SCORE_RULE = { base: 60, perLv: 8, strength: 100 };
const SCORE_RULE_KEY = "skillmap.scoreRule";
const ruleSkillPts = (rule, lv) => Math.min(100, rule.base + rule.perLv * lv); // 항목당 최고 100점
const SOURCES = ["자동추출", "자기평가", "프로젝트검증"];

// ── 성장 활동 → 숙련도 자동 상승 ───────────────────────────────────
// 활동을 기록하면 태그한 스킬의 Lv가 오르고 출처(근거)가 승격된다.
const ACT_TYPES = ["프로젝트", "자격증", "교육", "자기계발"];
const ACT_ICON = { 프로젝트: "🏗", 자격증: "🏅", 교육: "📚", 자기계발: "🌱" };
const ACT_DESC = { 프로젝트: "프로젝트 참여로 관련 역량이 향상됐어요.", 자격증: "자격 취득으로 전문성을 인정받았어요.", 교육: "교육 이수로 관련 역량을 학습했어요.", 자기계발: "자기계발 활동으로 역량을 키웠어요." };
// 활동 유형별로 부여하는 출처(근거 강도). 더 강한 근거로만 승격된다.
const ACT_SRC = { 프로젝트: "프로젝트검증", 자격증: "프로젝트검증", 교육: "자동추출", 자기계발: "자기평가" };
const SRC_RANK = { 자기평가: 1, 자동추출: 2, 프로젝트검증: 3 };

// 관리자·PM 계정 (데모). localStorage 데이터에 의존하지 않도록 코드에 고정.
const MANAGER_IDS = ["R131"]; // 김철 사장 = admin 계정
const isMgr = (e) => !!e && MANAGER_IDS.includes(e.id);

// 좌측 사이드바 메뉴 (mgr:true = 관리자 전용)
const MENU = [
  { key: "mypage", label: "마이페이지", icon: "user" },
  { key: "org", label: "조직도", icon: "org" },
  { key: "skills", label: "조직 역량", icon: "chart" },
  { key: "board", label: "프로젝트 보드", icon: "board" },
];

// 프로젝트 보드 소속 구분 — 본사/중부지사는 수행 사업이 완전히 달라 보드를 나눠서 본다
const SITES = ["본사", "중부지사"];

// 프로젝트 칸반 단계
const STAGES = ["대기", "진행", "검토", "완료", "공유"];
const ACTIVE_STAGES = ["진행", "검토"]; // "현재 일하는 중"으로 보는 단계
// 직급 서열(앞일수록 상위). 보고라인이 없어 직급으로 팀 내 계층을 근사한다.
const RANK_ORDER = ["대표이사", "사장", "부사장", "CFO", "CTO", "이사", "본부장", "원장", "소장", "실장", "그룹장", "팀장", "수석", "책임", "선임", "담당", "주임", "사원", "인턴"];
const rankIdx = (r) => { const i = RANK_ORDER.indexOf(r); return i === -1 ? RANK_ORDER.length : i; };
// 직원 → 그룹/본부 분류 키 (조직역량·매칭 필터용). 조직도 트리는 ORGTREE에서 직접 렌더.
// 지사 인원은 group("사업본부")이 아니라 지사 단위로 묶는다. 지사는 산하 본부가 하나뿐이라
// group으로 묶으면 "중부지사(부사장 1명)"과 "사업본부(50명)"으로 쪼개져, 지사를 골라도 산하 부서가 안 나온다.
const HQ_SITE = SITES[0]; // "본사" — 본사만 그룹·본부 단위로 세분한다
// divKeyOf는 ORG_DESCENDANTS 뒤에서 정의(지사의 실제 본부 레벨을 조직도로 판정하기 위함)
// 스킬명 정규화: 대소문자·공백 차이만 흡수(느슨한 부분일치는 Java→JavaScript 오매칭이라 지양)
// 같은 역량의 다른 표현(별칭) → 대표 스킬명. "연계"로 검색해도 "시스템 연계" 보유자가 잡히도록.
const SKILL_ALIAS = { 연계: "시스템 연계", 인터페이스: "시스템 연계", api연계: "시스템 연계", 시스템연동: "시스템 연계",
  자바스크립트: "JavaScript", 타입스크립트: "TypeScript", 자바: "Java", 파이썬: "Python", 리액트: "React", 스프링: "Spring", 오라클: "Oracle", 피그마: "Figma", 노드: "Node.js", 태블로: "Tableau", 엑셀: "Excel",
  보안: "정보보안", 행정: "행정업무", 문서: "문서관리", 제안서: "제안서작성", 일정: "일정관리", 요건: "요건분석", 클라우드: "AWS" };
// 강점을 다르게 표현한 말 → 강점 조건 (띄어쓰기 없앤 문장에서 찾음)
const STR_WORDS = { 협업: ["소통", "팀워크", "커뮤니케이션"], 문제해결: ["해결", "트러블슈팅"], 자기계발: ["공부", "학습", "성장"], 배려: ["친절", "배려"], 적극성: ["적극", "주도", "열정"], 업무성과: ["일잘", "성과", "실적"] };
// 설명 문장 속 분야 키워드 → 분야 조건(그 분야에서 가장 숙련된 스킬로 평가). 스킬명으로 못 찾은 "디자인 작업" 같은 요청용
const CAT_WORDS = [
  ["디자인", ["디자인", "디자이너", "ui", "ux", "화면설계", "일러스트"]],
  ["프론트엔드", ["프론트", "front", "퍼블리", "웹화면", "화면개발"]],
  ["백엔드", ["백엔드", "backend", "서버", "api개발", "개발자"]],
  ["기획/PM", ["기획", "pm", "pmo", "사업관리", "관리자"]],
  ["데이터", ["데이터", "분석", "통계", "시각화", "db", "sql"]],
  ["AI", ["ai", "인공지능", "llm", "머신러닝", "딥러닝", "생성형", "챗봇"]],
  ["도메인", ["공공", "민원", "전자정부"]],
];
const normRaw = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "");
const normSkill = (s) => { const n = normRaw(s); return SKILL_ALIAS[n] ? normRaw(SKILL_ALIAS[n]) : n; };
const skEq = (a, b) => normSkill(a) === normSkill(b);
// 같은 스킬이 두 번 담기면 React key가 충돌하고 레벨도 중복 반영된다 → 저장 전 항상 정규화 기준으로 1건만 남긴다.
const dedupeBy = (arr, keyOf) => {
  const seen = new Set();
  return arr.filter((x) => { const k = normSkill(keyOf(x)); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
// 조직도상 각 단위의 하위 단위 전체(자기 자신 포함). 팀 필터는 이름 완전일치가 아니라 이 집합으로 판정한다 —
// 예: 공공AX1팀을 고르면 산하 경영안정바우처·기후위기적응정보와 그 기술지원실 인원까지 함께 나와야 한다.
// (조직도 단위 78개 중 이름 중복 0건이라 이름을 키로 써도 안전)
const ORG_DESCENDANTS = (() => {
  const m = new Map();
  (function walk(n) {
    const names = new Set([n.name]);
    for (const c of n.children || []) {
      if (c.type === "unit") walk(c).forEach((x) => names.add(x));
    }
    m.set(n.name, names);
    return names;
  })(ORGTREE);
  return m;
})();
// 직원 e가 선택한 팀(sel)에 속하는가 — 직속이거나 그 산하 조직이면 true
const inTeam = (sel, t) => sel === t || !!ORG_DESCENDANTS.get(sel)?.has(t);

// 지사(중부지사)의 실제 "대표 부서" 판정. 조직도상 중부지사는 중부지사→사업본부→(공공AX1팀·식의약AX팀…)→팀 구조라
// group 필드(=사업본부)로 묶으면 대표부서가 "사업본부" 하나뿐이라, 그걸 고르면 지사 전원이 나온다.
// 대신 사업본부의 자식 단위를 대표부서로 삼는다(팀명 → 그 대표부서로 매핑).
const findNode = (root, name) => {
  let hit = null;
  (function w(n) { if (hit) return; if (n.name === name) { hit = n; return; } (n.children || []).forEach((c) => c.type === "unit" && w(c)); })(root);
  return hit;
};
const BRANCH_DIV = (() => {
  const map = {}; // 팀명 → 대표부서(사업본부의 자식)
  const anchor = findNode(ORGTREE, "사업본부");
  (anchor?.children || []).forEach((c) => {
    if (c.type !== "unit") return;
    (ORG_DESCENDANTS.get(c.name) || new Set([c.name])).forEach((teamName) => { map[teamName] = c.name; });
  });
  return map;
})();
// 직원 → 대표부서 키. 본사는 group(본부/그룹), 지사는 사업본부 자식 기준.
// 사업본부 자식에 안 잡히는 지사 리더십(부사장·본부장)은 "{지사} 직속" 버킷으로.
const divKeyOf = (e) => (e.site && e.site !== HQ_SITE ? (BRANCH_DIV[e.team] || `${e.site} 직속`) : e.group || e.site || "기타");
// 조직도 DFS 순서 — 팀 목록을 가나다순이 아닌 조직 배치 순서로 보이게 한다
const ORG_ORDER = (() => {
  const m = new Map(); let i = 0;
  (function walk(n) { for (const c of n.children || []) { if (c.type === "unit") { if (!m.has(c.name)) m.set(c.name, i++); walk(c); } } })(ORGTREE);
  return m;
})();
const orgOrderOf = (t) => ORG_ORDER.get(t) ?? 9999;
// 조직도 트리 헬퍼 — 단위별 정직원/협력 인원 분리 카운트
const orgCount = (n) => { let p = 0, s = 0; for (const c of n.children || []) { if (c.type === "unit") { const r = orgCount(c); p += r.p; s += r.s; } else if (c.type === "support") s++; else p++; } return { p, s }; };
const ALL_ORG_PATHS = (() => { const s = new Set(); (function w(n, p) { for (const c of n.children || []) { const cp = p + "/" + c.name; if (c.type === "unit") { s.add(cp); w(c, cp); } } })(ORGTREE, ORGTREE.name); return s; })();
const ORG_NSUPPORT = (() => { let s = 0; (function w(n) { for (const c of n.children || []) { if (c.type === "support") s++; else if (c.type === "unit") w(c); } })(ORGTREE); return s; })();
// 기본 접힘: 깊이 1 이상 단위는 접어둠(솔리데오→총괄/지사 까지만 펼쳐 보임)
const DEFAULT_ORG_COLLAPSED = (() => { const s = new Set(); (function w(n, p, d) { for (const c of n.children || []) { const cp = p + "/" + c.name; if (c.type === "unit") { if (d >= 1) s.add(cp); w(c, cp, d + 1); } } })(ORGTREE, ORGTREE.name, 0); return s; })();
const STAGE_COLOR = { 대기: "#94A3B8", 진행: "#2756D6", 검토: "#C9701C", 완료: "#2E8B57", 공유: "#6A45C9" };
// 사진이 없어 이름 기반 색상 이니셜 아바타로 표현
function nameColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 52%)`;
}

const CAT_STYLE = {
  프론트엔드: { bg: "#E7EEFF", fg: "#2E5BD6" },
  백엔드: { bg: "#EFE9FF", fg: "#6A45C9" },
  디자인: { bg: "#FDE9F1", fg: "#C24682" },
  "기획/PM": { bg: "#FFEEDC", fg: "#C9701C" },
  데이터: { bg: "#E2F4F3", fg: "#1F8A82" },
  AI: { bg: "#E4F5EA", fg: "#2E8B57" },
  도메인: { bg: "#ECEFF3", fg: "#5B6B7F" },
};

const SEED = ROSTER;

const blankDraft = () => ({
  id: null, name: "", team: "UX엔지니어링팀", rank: "", email: "", phone: "", strengths: [],
  skills: [["", 3, "프론트엔드", "자기평가"]], eduText: "", projText: "",
});

// ── 키 없이도 동작하는 목업 추출(폴백용) ───────────────────────────
// 붙여넣은 텍스트에서 키워드를 찾아 스킬/강점/교육/프로젝트를 추정한다.
const SKILL_DICT = [
  [/typescript|타입스크립트/i, "TypeScript", "프론트엔드"],
  [/javascript|자바스크립트/i, "JavaScript", "프론트엔드"],
  [/vue/i, "Vue.js", "프론트엔드"],
  [/react|리액트/i, "React", "프론트엔드"],
  [/html|css|scss/i, "HTML/CSS", "프론트엔드"],
  [/figma|피그마/i, "Figma", "디자인"],
  [/디자인시스템|ui\/?ux|ui\s*디자인|화면설계|디자인/i, "UI디자인", "디자인"],
  [/일러스트|illustrat|photoshop|포토샵/i, "일러스트", "디자인"],
  [/spring|스프링/i, "Spring", "백엔드"],
  [/\bjava\b|자바/i, "Java", "백엔드"],
  [/python|파이썬/i, "Python", "백엔드"],
  [/fastapi|django|flask|node/i, "백엔드 프레임워크", "백엔드"],
  [/mysql|postgres|oracle|데이터베이스|\bsql\b/i, "DB/SQL", "백엔드"],
  [/aws|docker|kubernetes|클라우드/i, "AWS/클라우드", "백엔드"],
  [/\bai\b|llm|gpt|rag|머신러닝|딥러닝|인공지능/i, "AI/LLM 연동", "AI"],
  [/excel|엑셀|데이터\s*분석|tableau|시각화/i, "데이터분석", "데이터"],
  [/\bpm\b|기획|프로젝트\s*관리|일정\s*관리|제안서/i, "프로젝트관리", "기획/PM"],
  [/행정|공공|조달|문서관리/i, "행정/공공업무", "도메인"],
];
const STR_DICT = [
  [/협업|팀워크|소통/i, "협업"],
  [/문제\s*해결|트러블|분석력/i, "문제해결"],
  [/자기\s*계발|학습|성장|스터디/i, "자기계발"],
  [/배려|친절|책임감/i, "배려"],
  [/적극|주도|능동/i, "적극성"],
  [/성과|실적|기여|매출/i, "업무성과"],
];

function mockExtract(text) {
  const t = (text || "").trim();
  if (!t) {
    return {
      name: "",
      skills: [
        { name: "React", category: "프론트엔드", level: 4 },
        { name: "TypeScript", category: "프론트엔드", level: 4 },
        { name: "Figma", category: "디자인", level: 3 },
      ],
      edu: ["정보보안 기초"], proj: ["공공 포털 구축"], strengths: ["협업", "문제해결"],
    };
  }
  const name = (t.match(/(?:이름|성명)\s*[:：]?\s*([가-힣]{2,4})/) || [])[1]
    || (t.match(/^([가-힣]{2,4})(?:[\s.,·|(]|입니다)/) || [])[1] || ""; // 문서 첫머리 이름도 추정
  const skills = [];
  for (const [re, nm, cat] of SKILL_DICT) {
    if (re.test(t) && !skills.some((s) => s.name === nm)) skills.push({ name: nm, category: cat, level: 4 });
  }
  const lines = t.split(/[\n·,]/).map((x) => x.trim()).filter(Boolean);
  const short = (s) => (s.length > 28 ? s.slice(0, 28) + "…" : s);
  const edu = [...new Set(lines.filter((l) => /교육|수료|이수|자격증|과정|certif/i.test(l)).map(short))].slice(0, 4);
  const proj = [...new Set(lines.filter((l) => /프로젝트|구축|개편|개발|시스템|운영/i.test(l)).map(short))].slice(0, 4);
  const strengths = [];
  for (const [re, s] of STR_DICT) if (re.test(t)) strengths.push(s);
  return {
    name,
    skills: skills.length ? skills : [{ name: "직무역량", category: "도메인", level: 3 }],
    edu, proj, strengths: [...new Set(strengths)],
  };
}

// 활동 1건을 직원 e에 반영: 태그한 스킬 Lv +1(최대5) & 출처 승격, 없던 스킬은 생성.
// skillDefs: [{ name, category }] — 활동 이력도 함께 추가한 새 직원 객체를 반환(순수 함수).
function applyActivity(e, { type, title, date, desc, skillDefs }) {
  const newSrc = ACT_SRC[type] || "자기평가";
  const skills = e.skills.map((s) => [...s]);
  const names = [];
  skillDefs.forEach(({ name, category }) => {
    const nm = (name || "").trim();
    if (!nm) return;
    names.push(nm);
    const idx = skills.findIndex((s) => skEq(s[0], nm)); // "react"/"React"가 따로 쌓이지 않도록 정규화 비교
    if (idx >= 0) {
      skills[idx][1] = Math.min(5, skills[idx][1] + 1);
      if ((SRC_RANK[newSrc] || 0) > (SRC_RANK[skills[idx][3]] || 0)) skills[idx][3] = newSrc;
    } else {
      skills.push([nm, 2, CATS.includes(category) ? category : "도메인", newSrc]);
    }
  });
  const activities = [...(e.activities || []), { type, title, date, desc: desc || "", skills: names }];
  return { ...e, skills, activities };
}

const PROJ_KEY = "skillmap.projects.v4";
const PROJ_SEED_KEY = "skillmap.projects.seed"; // 시드 보강 이력 (지사 프로젝트 1회 주입용)
const PROJ_SEED_TAG = "site-split-2"; // 시드를 추가하면 값을 올린다 — 기존 저장 데이터에 새 시드(PJ6 등)만 1회 보강
// 데모 시드 프로젝트 (DB 없이 첫 실행 시 화면에 깔리는 초기 데이터).
// 실제 근무자명단 인물·팀으로 구성 — 진행/검토는 "투입", R162 김진호는 2건 겹쳐 "풀로드".
const SEED_PROJECTS = [
  { id: "PD1", title: "정부24 클라우드 네이티브 전환 2차", date: "2026-05", lead: "조성용", status: "진행", verified: false,
    desc: "정부24 핵심 서비스의 컨테이너·MSA 전환 2차 사업.",
    skills: [{ name: "Java", category: "백엔드" }, { name: "FastAPI", category: "백엔드" }, { name: "AWS", category: "백엔드" }, { name: "전자정부", category: "도메인" }],
    members: [{ id: "R119", name: "조성용" }, { id: "R120", name: "곽상규" }, { id: "R121", name: "이혜민" }, { id: "R122", name: "장혜린" }] },
  { id: "PD2", title: "AI 행정심사 플랫폼 고도화", date: "2026-06", lead: "김선일", status: "진행", verified: false,
    desc: "RAG 기반 행정심사 보조 AI 플랫폼 고도화.",
    skills: [{ name: "AI/LLM 연동", category: "AI" }, { name: "RAG 검색", category: "AI" }, { name: "프롬프트 엔지니어링", category: "AI" }, { name: "FastAPI", category: "백엔드" }],
    members: [{ id: "R159", name: "김선일" }, { id: "R161", name: "조창권" }, { id: "R162", name: "김진호" }, { id: "R051", name: "조민상" }] },
  { id: "PD3", title: "범정부 마이데이터 연계 구축", date: "2026-06", lead: "박주성", status: "검토", verified: false,
    desc: "공공 마이데이터 표준 연계 모듈 구축 — 산출물 검토 단계.",
    skills: [{ name: "AI/LLM 연동", category: "AI" }, { name: "AWS", category: "백엔드" }, { name: "RAG 검색", category: "AI" }],
    members: [{ id: "R055", name: "박주성" }, { id: "R056", name: "추봉호" }, { id: "R057", name: "김효건" }, { id: "R162", name: "김진호" }] },
  { id: "PD4", title: "공공포털 UI/UX 리뉴얼", date: "2026-05", lead: "김계현", status: "검토", verified: false,
    desc: "대국민 포털 접근성·디자인시스템 기반 리뉴얼.",
    skills: [{ name: "React", category: "프론트엔드" }, { name: "UI디자인", category: "디자인" }, { name: "Figma", category: "디자인" }, { name: "디자인시스템", category: "디자인" }],
    members: [{ id: "R127", name: "김계현" }, { id: "R059", name: "김선애" }, { id: "R128", name: "김선진" }, { id: "R177", name: "박선우" }] },
  { id: "PD5", title: "세움터 건축행정 유지보수 (2025)", date: "2025-11", lead: "박주현", status: "완료", verified: true,
    desc: "건축행정시스템 연간 유지보수 — 완료·검증됨.",
    skills: [{ name: "AWS", category: "백엔드" }, { name: "Spring", category: "백엔드" }, { name: "전자정부", category: "도메인" }],
    members: [{ id: "R107", name: "박주현" }, { id: "R108", name: "박한준" }, { id: "R109", name: "유보희" }] },
  { id: "PD6", title: "공공 마이데이터 신규사업 제안", date: "2026-11", lead: "황순한", status: "대기", verified: false,
    desc: "하반기 신규 제안 — 착수 대기.",
    skills: [{ name: "프로젝트관리", category: "기획/PM" }, { name: "제안서작성", category: "기획/PM" }],
    members: [{ id: "R139", name: "황순한" }, { id: "R140", name: "김태현" }] },
  // ── 중부지사 수행 사업 ──────────────────────────────────────────
  { id: "PJ1", title: "의약품 AI 심사지원 시스템 구축", date: "2026-06", lead: "홍대식", status: "진행", verified: false,
    desc: "식약처 의약품 허가심사 AI 보조 시스템 구축 — 심사자료 자동 분석·요약.",
    skills: [{ name: "AI/LLM 연동", category: "AI" }, { name: "RAG 검색", category: "AI" }, { name: "Python", category: "백엔드" }, { name: "전자정부", category: "도메인" }],
    members: [{ id: "R197", name: "홍대식" }, { id: "R198", name: "강지웅" }, { id: "R199", name: "박해선" }, { id: "R200", name: "유정민" }] },
  { id: "PJ2", title: "소상공인 경영안정 바우처 운영", date: "2026-05", lead: "김태운", status: "진행", verified: false,
    desc: "바우처 신청·심사·지급 전 과정 운영 및 연간 고도화.",
    skills: [{ name: "Java", category: "백엔드" }, { name: "Spring", category: "백엔드" }, { name: "Oracle", category: "백엔드" }],
    members: [{ id: "R182", name: "김태운" }, { id: "R184", name: "김영민" }, { id: "R186", name: "김지성" }, { id: "R188", name: "서난희" }] },
  { id: "PJ3", title: "기후위기 적응정보 플랫폼 고도화", date: "2026-06", lead: "홍재필", status: "검토", verified: false,
    desc: "기후 적응정보 수집·시각화 플랫폼 고도화 — 산출물 검토 단계.",
    skills: [{ name: "Python", category: "백엔드" }, { name: "데이터시각화", category: "데이터" }, { name: "AWS", category: "백엔드" }],
    members: [{ id: "R191", name: "홍재필" }, { id: "R194", name: "장유진" }, { id: "R193", name: "이종현" }, { id: "R190", name: "김민철" }] },
  { id: "PJ4", title: "중부권 통합유지관리 (2026)", date: "2026-01", lead: "장유재", status: "진행", verified: false,
    desc: "중부지사 수행 공공시스템 통합 유지관리 — 연간 상시 운영.",
    skills: [{ name: "Java", category: "백엔드" }, { name: "Oracle", category: "백엔드" }, { name: "전자정부", category: "도메인" }],
    members: [{ id: "R204", name: "장유재" }, { id: "R207", name: "신창규" }, { id: "R209", name: "이누리" }, { id: "R211", name: "이제인" }] },
  { id: "PJ5", title: "지사 UX 디자인시스템 정비", date: "2026-12", lead: "우덕성", status: "대기", verified: false,
    desc: "중부지사 수행 사업 공통 UI 컴포넌트·디자인시스템 정비 — 착수 대기.",
    skills: [{ name: "UI디자인", category: "디자인" }, { name: "디자인시스템", category: "디자인" }, { name: "Figma", category: "디자인" }],
    members: [{ id: "R176", name: "우덕성" }, { id: "R177", name: "박선우" }, { id: "R252", name: "김지애" }] },
  { id: "PJ6", title: "중부지사 사업 제안서·산출물 표준화", date: "2026-09", lead: "윤승미", status: "진행", verified: false,
    desc: "지사 수행 사업의 제안서 양식·산출물 문서 체계를 표준화 — 공통지원팀 주관.",
    skills: [{ name: "제안서작성", category: "기획/PM" }, { name: "문서관리", category: "도메인" }, { name: "요건분석", category: "기획/PM" }],
    members: [{ id: "R175", name: "윤승미" }, { id: "R174", name: "김종훈" }] },
];
const SEED_DATE_FIX = { PD6: ["2026-07", "2026-11"], PJ5: ["2026-07", "2026-12"] };
function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJ_KEY);
    let parsed = raw ? JSON.parse(raw) : SEED_PROJECTS; // 첫 실행 → 데모 시드
    if (!Array.isArray(parsed)) return [];
    // 본사 시드만 갖고 있던 기존 사용자에게 지사 시드를 1회 보강한다(직접 만든 프로젝트는 그대로 보존).
    // 표식 기록은 반드시 effect에서 — StrictMode가 이 초기화 함수를 2번 호출하므로
    // 여기서 표식을 쓰면 2번째 호출이 보강을 건너뛰어 지사 프로젝트가 사라진다.
    if (raw && localStorage.getItem(PROJ_SEED_KEY) !== PROJ_SEED_TAG) {
      const have = new Set(parsed.map((p) => p.id));
      parsed = [...parsed, ...SEED_PROJECTS.filter((p) => !have.has(p.id))];
    }
    // 이전 버전 데이터 정규화(상태 없음 / skills가 문자열 배열)
    return parsed.map((p) => ({
      ...p,
      // 착수 대기 시드의 지난 날짜(2026-07)를 앞으로 당김 — 직접 수정한 날짜는 그대로
      ...(SEED_DATE_FIX[p.id] && p.date === SEED_DATE_FIX[p.id][0] && p.status === "대기" ? { date: SEED_DATE_FIX[p.id][1] } : {}),
      status: STAGES.includes(p.status) ? p.status : "진행",
      verified: p.verified ?? true,
      skills: dedupeBy((p.skills || []).map((s) => (typeof s === "string" ? { name: s, category: "도메인" } : s)), (s) => s.name),
    }));
  } catch {
    return [];
  }
}

// 단색 라인 아이콘 세트 (이모지 대체). 24x24 viewBox, currentColor.
const ICONS = {
  spark: "M12 3l1.8 4.6L18.4 9l-4.6 1.8L12 15l-1.8-4.2L5.6 9l4.6-1.4L12 3z",
  match: "M4 7h7M4 12h10M4 17h6M16 14l5 5m-2.5-9.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  org: "M9 4h6v4H9zM4 16h6v4H4zm10 0h6v4h-6zM12 8v4M7 16v-2h10v2",
  board: "M4 5h16v14H4zM9 5v14M15 5v14",
  lock: "M6 11V8a6 6 0 1112 0v3M5 11h14v9H5z",
  unlock: "M6 11V8a6 6 0 0111.6-2M5 11h14v9H5z",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  phone: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.4 2.1L8 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  clip: "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48",
};
function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={ICONS[name] || ""} />
    </svg>
  );
}

// 커스텀 드롭다운 — 네이티브 <select>는 목록 높이에 따라 열림 방향이 제각각이라(옵션 수가 다르면 위/아래로 갈림)
// 방향을 통일할 수 없다. 항상 아래로 열리고 화살표도 브라우저 무관하게 동일하게 그린다.
// options: [{ value, label }]. value가 옵션에 없으면 placeholder를 닫힌 라벨로 보여준다(= 필터 미선택 상태).
function Dropdown({ value, onChange, options, placeholder, className = "", sizeWith }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // 키보드 하이라이트 인덱스
  const ref = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev) => { if (ref.current && !ref.current.contains(ev.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  // 열릴 때 현재 선택 항목을 하이라이트 시작점으로
  useEffect(() => { if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value))); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = options.find((o) => o.value === value);
  // sizeWith: 옵션 목록이 바뀌어도 폭을 고정하기 위한 추가 사이징 라벨(예: 전체 팀명 중 최장)
  const allLabels = [...options.map((o) => o.label), ...(placeholder ? [placeholder] : []), ...(sizeWith || [])];
  const pick = (i) => { const o = options[i]; if (o) { onChange(o.value); setOpen(false); } };
  const onKeyDown = (ev) => {
    if (!open) { if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(ev.key)) { ev.preventDefault(); setOpen(true); } return; }
    if (ev.key === "Escape") { ev.preventDefault(); setOpen(false); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (ev.key === "Home") { ev.preventDefault(); setActive(0); }
    else if (ev.key === "End") { ev.preventDefault(); setActive(options.length - 1); }
    else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(active); }
    else if (ev.key === "Tab") { setOpen(false); }
  };
  const caret = (
    <svg className={"dd-caret" + (open ? " up" : "")} width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
  );
  return (
    <div className={"dd " + className} ref={ref}>
      <button type="button" className="dd-trigger" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}>
        {/* 숨김 사이저: 가장 긴 옵션 기준으로 트리거 폭 고정 — 선택값이 바뀌어도 폭이 안 흔들리고 딱 맞는다 */}
        <span className="dd-sizer" aria-hidden="true">{allLabels.map((l, i) => <span key={i}>{l}</span>)}</span>
        <span className="dd-face">
          <span className={"dd-cur" + (current ? "" : " dd-ph")}>{current ? current.label : placeholder}</span>
          {caret}
        </span>
      </button>
      {open && (
        <ul className="dd-menu" role="listbox">
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}
              className={"dd-opt" + (o.value === value ? " on" : "") + (i === active ? " active" : "")}
              onMouseEnter={() => setActive(i)}
              onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [emps, setEmps] = useState(loadEmps);
  const [authId, setAuthId] = useState(() => lsGet(AUTH_KEY) || null); // 자동 로그인 복원
  const [dark, setDark] = useState(() => lsGet(THEME_KEY) === "dark"); // 테마: 기본 라이트
  useEffect(() => { try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch { /* 무시 */ } }, [dark]);
  const [loginId, setLoginId] = useState(() => lsGet(SAVED_ID_KEY) || ""); // 저장된 아이디
  const [loginPw, setLoginPw] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [rememberId, setRememberId] = useState(() => !!lsGet(SAVED_ID_KEY));
  const [autoLogin, setAutoLogin] = useState(() => !!lsGet(AUTH_KEY));
  const [help, setHelp] = useState(null); // null | "id" | "pw" — 아이디/비밀번호 찾기 안내
  // 토스트: 행동 피드백 (저장·삭제·성장 등). notify()로 띄우고 2.6초 뒤 자동 사라짐
  const [toast, setToast] = useState(null);
  const toastTimer = React.useRef(null);
  const notify = (msg, kind = "ok") => {
    setToast({ msg, kind, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === "grow" ? 4200 : 2600); // 성장 토스트는 내용이 길어 조금 더 노출
  };
  const [confirmDel, setConfirmDel] = useState(null); // 삭제 확인 팝업: { kind:"proj"|"emp", id, title }
  const [projView, setProjView] = useState(null);     // 프로젝트 상세 팝업 (카드 클릭 시)
  const [actView, setActView] = useState(null);        // 역량 개발 항목 상세 팝업 { activity, empName }
  const [nav, setNav] = useState("mypage"); // 사이드바 현재 페이지
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("전체");
  const [skillSite, setSkillSite] = useState(SITES[0]); // 조직역량 필터: 본사/중부지사 (탭)
  const [skillDiv, setSkillDiv] = useState("전체"); // 대표 부서(본부) — 본사처럼 본부가 여럿일 때 1단 드롭다운
  // team 상태는 2단(대표 부서 안의 팀) 필터. 둘 다 조직도 단위명이며 계층 매칭(inTeam)으로 산하까지 포함
  const [open, setOpen] = useState(null);
  const [actFor, setActFor] = useState(null); // 활동 추가 폼이 열린 직원 id
  const [actForm, setActForm] = useState({ type: "프로젝트", title: "", date: "", desc: "", skills: [], newSkill: "" });
  const [pfDraft, setPfDraft] = useState(null); // 포트폴리오 링크 입력 폼 { id, title, url }
  const [projects, setProjects] = useState(loadProjects);
  const [projDraft, setProjDraft] = useState(null);
  const [boardSite, setBoardSite] = useState(SITES[0]); // 프로젝트 보드: 본사/중부지사 (로그인 시 본인 소속으로 맞춤)
  const [pmDiv, setPmDiv] = useState("");    // 팀원 선택: 본부/지사 필터
  const [pmTeam, setPmTeam] = useState("");  // 팀원 선택: 팀 필터
  const [pmQuery, setPmQuery] = useState(""); // 팀원 선택: 이름 검색
  const [evalResult, setEvalResult] = useState(null); // 조합 평가 결과
  const [reqSkills, setReqSkills] = useState([]);
  const [reqStrengths, setReqStrengths] = useState([]);
  const [req, setReq] = useState(""); // 추가 설명(선택)
  const [matches, setMatches] = useState([]);
  const [matchEngine, setMatchEngine] = useState(null); // "ai" | "local" — 결과 출처 표시
  const [loading, setLoading] = useState(false);
  // 적합도 기준(관리자 조정 가능) — 바꾸면 화면의 적합도·계산식이 즉시 다시 계산된다
  const [scoreRule, setScoreRule] = useState(() => {
    try {
      const r = JSON.parse(localStorage.getItem(SCORE_RULE_KEY) || "null");
      if (r && [r.base, r.perLv, r.strength].every((v) => Number.isFinite(v))) return { ...DEFAULT_SCORE_RULE, ...r };
    } catch { /* 저장값이 깨졌으면 초기값 */ }
    return DEFAULT_SCORE_RULE;
  });
  useEffect(() => { try { localStorage.setItem(SCORE_RULE_KEY, JSON.stringify(scoreRule)); } catch { /* 저장 불가 환경 */ } }, [scoreRule]);
  const ruleCustom = ["base", "perLv", "strength"].some((k) => scoreRule[k] !== DEFAULT_SCORE_RULE[k]);
  const setRuleField = (k, v) => { const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); setScoreRule((r) => ({ ...r, [k]: n })); };
  const [loadStep, setLoadStep] = useState(0); // AI 매칭 대기 중 단계 문구 순환
  useEffect(() => {
    if (!loading) { setLoadStep(0); return; }
    const t = setInterval(() => setLoadStep((s) => s + 1), 1600);
    return () => clearInterval(t);
  }, [loading]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [exText, setExText] = useState("");
  const [exLoading, setExLoading] = useState(false);
  const [exErr, setExErr] = useState("");
  const [exNote, setExNote] = useState("");
  const [exFile, setExFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [page, setPage] = useState(1);          // 직원 목록 페이지
  const [sortBy, setSortBy] = useState("rank");  // rank | name | team — 기본 직급순
  const [skillQuery, setSkillQuery] = useState(""); // 역량 자동완성 검색어
  const [orgQuery, setOrgQuery] = useState("");      // 조직도 이름/팀 검색
  const [orgCollapsed, setOrgCollapsed] = useState(DEFAULT_ORG_COLLAPSED); // 조직도 트리에서 접은 단위(path Set)
  const PAGE = 24;

  // 직원/프로젝트 데이터가 바뀔 때마다 localStorage에 자동 저장 → 페이지를 나가도 유지됨
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(emps)); } catch { /* 저장 용량 초과 등은 무시 */ }
  }, [emps]);
  useEffect(() => {
    try { localStorage.setItem(PROJ_KEY, JSON.stringify(projects)); } catch { /* 무시 */ }
  }, [projects]);
  // 시드 보강 표식은 마운트 후 1회 (초기화 함수를 순수하게 유지 — StrictMode 2회 호출 대응)
  useEffect(() => {
    try { localStorage.setItem(PROJ_SEED_KEY, PROJ_SEED_TAG); } catch { /* 무시 */ }
  }, []);
  // 모달 열릴 때 배경 스크롤 잠금 (스크롤바 2중 방지)
  useEffect(() => {
    document.body.style.overflow = (draft || projDraft) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [draft, projDraft]);
  // 로그인 시 보드 기본 지사를 본인 소속으로 (중부지사 직원이 남의 지사 보드를 먼저 보지 않도록)
  useEffect(() => {
    const site = emps.find((e) => e.id === authId)?.site;
    if (site && SITES.includes(site)) { setBoardSite(site); setSkillSite(site); } // 조직 역량도 본인 지사부터
  }, [authId]); // eslint-disable-line react-hooks/exhaustive-deps


  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = emps.filter((e) => {
      if ((e.site || SITES[0]) !== skillSite) return false; // 지사 탭으로 1차 분리
      if (skillDiv !== "전체" && divKeyOf(e) !== skillDiv) return false;       // 1단: 대표부서 정확 일치(래퍼가 전원 잡는 것 방지)
      if (team !== "전체" && !inTeam(team, e.team)) return false;              // 2단: 팀(산하 포함, 대표부서로 이미 한정됨)
      if (!kw) return true;
      return e.name.toLowerCase().includes(kw) ||
        e.skills.some((s) => s[0].toLowerCase().includes(kw)) ||
        e.strengths.some((s) => s.toLowerCase().includes(kw));
    });
    const cmp = sortBy === "rank" ? (a, b) => rankIdx(a.rank) - rankIdx(b.rank) || a.name.localeCompare(b.name, "ko")
      : sortBy === "team" ? (a, b) => a.team.localeCompare(b.team, "ko") || a.name.localeCompare(b.name, "ko")
      : (a, b) => a.name.localeCompare(b.name, "ko");
    return [...list].sort(cmp);
  }, [q, team, skillDiv, skillSite, emps, sortBy]);
  useEffect(() => { setPage(1); }, [q, team, skillDiv, skillSite, sortBy]);
  useEffect(() => { window.scrollTo(0, 0); }, [nav]); // 페이지 전환 시 상단으로
  // ESC로 열린 모달/패널 닫기 (C1)
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === "Escape") { setDraft(null); setProjDraft(null); setActFor(null); setConfirmDel(null); setProjView(null); setActView(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 분포는 선택한 지사 기준. 대표부서·팀을 고르면 그만큼 더 좁힌다(계단식).
  const distUnit = team !== "전체" ? team : (skillDiv !== "전체" ? skillDiv : "전체");
  const distEmps = emps.filter((e) => (e.site || SITES[0]) === skillSite
    && (skillDiv === "전체" || divKeyOf(e) === skillDiv)   // 대표부서 정확 일치
    && (team === "전체" || inTeam(team, e.team)));          // 팀 산하 포함
  const catDist = CATS.map((c) => ({ c, n: distEmps.filter((e) => e.skills.some((s) => s[2] === c)).length }));
  const catMax = Math.max(1, ...catDist.map((d) => d.n));
  const strDist = STRENGTHS.map((s) => ({ s, n: distEmps.filter((e) => e.strengths.includes(s)).length }));
  const strMax = Math.max(1, ...strDist.map((d) => d.n));
  // 인사이트: 가장 두터운/얇은 분야 (실행 힌트)
  const catSorted = [...catDist].sort((a, b) => a.n - b.n);
  const distInsight = distEmps.length ? { weak: catSorted[0], strong: catSorted[catSorted.length - 1], scope: distUnit === "전체" ? skillSite : distUnit, total: distEmps.length } : null;

  const toggleReqSkill = (s) => setReqSkills((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);
  const toggleReqStrength = (s) => setReqStrengths((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);

  // 선택한 역량·강점으로 직접 점수 계산(키 없을 때 폴백). 비공개자도 후보 포함.
  // 선택한 역량·강점 + 추가 설명 속 기술명/강점 키워드(예: "React 경험 우대")를 합친 실제 요구 조건
  // 설명 문장 해석: ① 스킬명·별칭(긴 것부터, 찾은 부분은 지워 "javascript"가 "java"로 또 잡히지 않게)
  // ② 남은 문장에서 분야 키워드("디자인 작업" → 디자인 분야) ③ 강점. 결과 = 요구 스킬·강점·분야
  function matchReq() {
    const txt = req.trim().toLowerCase();
    const txtSkills = [], txtCats = [];
    if (txt) {
      let work = txt.replace(/\s+/g, "");
      const cands = [...Object.entries(SKILL_ALIAS), ...allSkills.map((s) => [normRaw(s), s])]
        .filter(([k]) => k.length >= 2).sort((a, b) => b[0].length - a[0].length);
      for (const [k, v] of cands) {
        if (!work.includes(k)) continue;
        work = work.split(k).join("|");
        if (allSkills.includes(v) && !txtSkills.includes(v)) txtSkills.push(v);
      }
      for (const [cat, words] of CAT_WORDS) if (words.some((w) => work.includes(w))) txtCats.push(cat);
    }
    const flat = txt.replace(/\s+/g, "");
    const txtStr = txt ? STRENGTHS.filter((s) => txt.includes(s) || (STR_WORDS[s] || []).some((w) => flat.includes(w))) : [];
    const skills = [...reqSkills, ...txtSkills.filter((s) => !reqSkills.some((rs) => skEq(rs, s)))];
    const strengths = [...reqStrengths, ...txtStr.filter((s) => !reqStrengths.includes(s))];
    // 이미 그 분야의 구체적인 스킬을 요구했다면 분야 조건은 중복이라 뺀다
    const cats = txtCats.filter((c) => !skills.some((s) => skillCatOf(s) === c));
    return { skills, strengths, cats };
  }
  // 분야 조건에서 그 사람의 가장 숙련된 스킬
  const bestInCat = (e, c) => e.skills.filter((s) => s[2] === c).sort((a, b) => b[1] - a[1])[0];
  // 규칙 기반 추천 이유 — "왜 이 사람인지"를 숙련도·검증 이력·투입 상황·부족 역량까지 한 문단으로
  function explainMatch(e, rSkills, mSkills, mStr, rCats = []) {
    const sents = [];
    const catSk = rCats.map((c) => bestInCat(e, c)).filter(Boolean);
    const sk = [...mSkills.map((rs) => e.skills.find((s) => skEq(s[0], rs))).filter(Boolean), ...catSk].sort((a, b) => b[1] - a[1]);
    if (sk.length) {
      const lvTxt = sk.map((s) => `${s[0]} Lv.${s[1]}`).join("·");
      const top = sk[0][1] >= 4 ? " — 팀 내에서 리드 가능한 수준" : sk[0][1] >= 3 ? " — 혼자 업무 수행 가능한 수준" : "";
      sents.push(`${rCats.length && !mSkills.length ? `${rCats.join("·")} 분야` : "요구 기술"} 중 ${lvTxt} 보유${top}.`);
    }
    // 근거: 요구 기술(분야 조건이면 그 분야 스킬)을 쓴 프로젝트·교육·자격 이력
    const evSkills = [...mSkills, ...catSk.map((s) => s[0])];
    const ev = (e.activities || []).filter((a) => (a.skills || []).some((n) => evSkills.some((rs) => skEq(n, rs))))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 2);
    if (ev.length) sents.push(`${ev.map((a) => `'${a.title}'(${a.type}${a.date ? ", " + a.date : ""})`).join(", ")} 이력으로 검증됨.`);
    else if (sk.some((s) => s[3] === "프로젝트검증")) sents.push("프로젝트 수행으로 검증된 역량.");
    if (mStr.length) sents.push(`강점 ${mStr.join("·")}.`);
    const act = activeByEmp[e.id] || [];
    sents.push(act.length === 0 ? "현재 투입 중인 프로젝트가 없어 바로 합류 가능."
      : act.length === 1 ? `현재 '${act[0]}' 진행 중 — 병행 가능 여부 확인 필요.`
      : `현재 ${act.length}건 동시 투입(풀로드) — 일정 조율 필요.`);
    const miss = [...rSkills.filter((rs) => !mSkills.includes(rs)), ...rCats.filter((c) => !bestInCat(e, c)).map((c) => `${c} 분야`)];
    if (miss.length) sents.push(`미보유: ${miss.join("·")} — 팀 구성으로 보완 권장.`);
    return sents.join(" ");
  }
  // 적합도 = 요구 항목별 점수의 평균. 화면의 "적합도 계산 기준"과 같은 공식이며, AI 모드에서도 이 공식으로 표시한다
  // (AI는 후보 선정·추천 이유만 담당) — 누가 배치하든 같은 기준으로 비교할 수 있게.
  function scoreBreakdown(e, rSkills, rStr, rCats = []) {
    const items = [
      ...rSkills.map((rs) => {
        const sk = e.skills.find((s) => skEq(s[0], rs));
        return sk ? { label: `${sk[0]} Lv.${sk[1]}`, pts: ruleSkillPts(scoreRule, sk[1]) } : { label: `${rs} 미보유`, pts: 0, miss: true };
      }),
      // 분야 조건: 그 분야에서 가장 숙련된 스킬로 계산 (보유 기술과 같은 공식)
      ...rCats.map((c) => {
        const sk = bestInCat(e, c);
        return sk ? { label: `${c} 분야(${sk[0]} Lv.${sk[1]})`, pts: ruleSkillPts(scoreRule, sk[1]) } : { label: `${c} 분야 없음`, pts: 0, miss: true };
      }),
      ...rStr.map((s) => (e.strengths.includes(s) ? { label: `강점 ${s}`, pts: scoreRule.strength } : { label: `강점 ${s} 없음`, pts: 0, miss: true })),
    ];
    const score = items.length ? Math.round(items.reduce((a, x) => a + x.pts, 0) / items.length) : 0;
    return { items, score };
  }
  function localMatch() {
    const { skills: rSkills, strengths: rStr, cats: rCats } = matchReq();
    return emps.map((e) => {
      const mSkills = rSkills.filter((rs) => e.skills.some((s) => skEq(s[0], rs)));
      const mStr = rStr.filter((rs) => e.strengths.includes(rs));
      const catSk = rCats.map((c) => bestInCat(e, c)).filter(Boolean);
      const lv = mSkills.reduce((a, rs) => { const sk = e.skills.find((s) => skEq(s[0], rs)); return a + (sk ? sk[1] : 0); }, 0) + catSk.reduce((a, s) => a + s[1], 0);
      const hit = mSkills.length + mStr.length + catSk.length;
      const { score } = scoreBreakdown(e, rSkills, rStr, rCats);
      const load = (activeByEmp[e.id] || []).length; // 현재 투입 건수
      return { id: e.id, name: e.name, score, _hit: hit, _lv: lv, _load: load, reason: explainMatch(e, rSkills, mSkills, mStr, rCats) };
    }).filter((x) => x._hit > 0).sort((a, b) => b.score - a.score || a._load - b._load || b._lv - a._lv || rankIdx(empById(b.id)?.rank) - rankIdx(empById(a.id)?.rank)).slice(0, 3);
  }

  async function match() {
    if (!reqSkills.length && !reqStrengths.length && !req.trim()) { setError("필요 역량이나 강점을 한 가지 이상 선택하세요."); return; }
    setLoading(true); setError(""); setMatches([]); setMatchEngine(null);
    const parts = [];
    if (reqSkills.length) parts.push(`필요 기술: ${reqSkills.join(", ")}`);
    if (reqStrengths.length) parts.push(`필요 강점: ${reqStrengths.join(", ")}`);
    if (req.trim()) parts.push(`추가 설명: ${req.trim()}`);
    const requirement = parts.join("\n");
    try {
      // 프라이버시: 실명·연락처·내부 ID는 외부 API로 보내지 않는다. 요청마다 순서를 섞어 일회용 익명 ID(P1, P2…)를
      // 새로 붙이고, 응답의 익명 ID를 이 요청의 대응표로만 실제 직원에 되돌린다 — 요청 간에 같은 사람을 추적할 단서가 없다.
      const shuffled = [...emps].sort(() => Math.random() - 0.5);
      const alias = new Map(shuffled.map((e, i) => [`P${i + 1}`, e.id]));
      const compact = shuffled.map((e, i) => ({ id: `P${i + 1}`, team: e.team, rank: e.rank, skills: e.skills.map((s) => `${s[0]}(${s[1]})`), edu: e.edu, proj: e.proj, strengths: e.strengths,
        history: (e.activities || []).map((a) => `${a.type}:${a.title}(${(a.skills || []).join("/")})`), activeProjects: (activeByEmp[e.id] || []).length }));
      const prompt = `다음은 직원 목록(JSON)과 프로젝트 요건입니다. 요건에 가장 적합한 직원을 최대 3명 선정하세요.
순수 JSON 배열만 출력합니다. 설명·코드펜스 없이:
[{"id":"직원id(목록의 id를 그대로)","score":적합도_0_100_정수,"reason":"왜 적합한지 2~3문장. ①요구 기술의 숙련도(괄호 안 숫자=Lv1~5) ②history의 프로젝트·교육 이력 근거 ③activeProjects(현재 투입 건수: 0=바로 합류 가능, 2+=풀로드) ④요구 중 부족한 역량이 있으면 함께 언급"}]
적합도 높은 순으로 정렬하세요. 반드시 목록에 있는 id만 사용하고, reason 문장에는 id를 쓰지 마세요.

직원목록: ${JSON.stringify(compact)}

프로젝트 요건:
${requirement}`;
      const res = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) throw new Error("api " + res.status);
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const parsed = JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
      // 목록에 없는 id만 돌아오거나 빈 배열이면 화면이 비므로 규칙 기반으로 넘긴다
      const valid = (Array.isArray(parsed) ? parsed : [])
        .map((m) => ({ ...m, id: alias.get(String(m.id)) })) // 익명 ID → 실제 직원 (대응표에 없으면 버림)
        .filter((m) => m.id && matchEmp(m));
      if (!valid.length) throw new Error("empty ai result");
      // 적합도 숫자는 AI가 매긴 값 대신 공통 공식으로 다시 계산 — 기준이 공개되고 누구에게나 같다
      const r = matchReq();
      const scored = valid.map((m, i) => { const bd = scoreBreakdown(matchEmp(m), r.skills, r.strengths, r.cats); return { ...m, score: bd.items.length ? bd.score : m.score, _ai: i }; });
      setMatches(scored.sort((a, b) => b.score - a.score || a._ai - b._ai));
      setMatchEngine("ai");
    } catch {
      // 키 없음/실패 → 선택 항목으로 로컬 점수 계산
      const local = localMatch();
      if (local.length) { setMatches(local); setMatchEngine("local"); }
      else setError(reqSkills.length || reqStrengths.length
        ? "선택한 조건에 맞는 직원이 없어요. 역량·강점을 바꿔보세요."
        : "설명에서 기술·분야·강점을 찾지 못했어요. 예: React·자바 같은 기술, 디자인·데이터·기획·AI·백엔드 같은 분야, 협업 같은 강점을 넣어 주세요. (AI 분석을 켜면 어떤 문장이든 해석합니다)");
    } finally {
      setLoading(false);
      // 결과가 버튼 아래에 생기므로 뷰포트 밖이면 스크롤로 안내 (C2)
      setTimeout(() => document.querySelector(".mengine, .err")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
    }
  }

  const empByName = (n) => emps.find((e) => e.name === n);
  const empById = (id) => emps.find((e) => e.id === id);
  // 매칭 결과 항목 → 실제 직원 (id 우선, 구버전/AI 호환용으로 name 폴백)
  const matchEmp = (m) => empById(m.id) || empByName(m.name);
  // 카드에 보일 적합도: 공통 공식(해석된 조건이 없을 때만 AI가 준 점수)
  const cardScore = (m) => { const e = matchEmp(m); if (!e) return m.score; const r = matchReq(); const bd = scoreBreakdown(e, r.skills, r.strengths, r.cats); return bd.items.length ? bd.score : m.score; };
  // 직원 역량 보기로 이동 — 지사 탭도 그 직원 소속으로 맞춘다(안 맞추면 중부지사 인원이 빈 목록으로 뜸)
  const goEmp = (e) => { setSkillSite(e.site || SITES[0]); setQ(e.name); setSkillDiv("전체"); setTeam("전체"); setNav("skills"); };
  // 조직도는 정적 ORGTREE 기반이라, 현재 직원 데이터와 맞춘 사본을 그린다:
  // 삭제·이름변경된 정직원은 빼고, 새로 추가된 직원은 소속 팀 노드(없으면 지사/루트) 아래에 붙인다.
  const orgTree = (() => {
    const byName = new Map(emps.map((e) => [e.name, e]));
    const placed = new Set();
    const clone = (n) => ({
      ...n,
      children: (n.children || []).flatMap((c) => {
        if (c.type === "unit") return [clone(c)];
        if (c.type === "support") return [c];
        const e = byName.get(c.name);
        if (!e) return [];
        placed.add(e.name);
        return [{ ...c, rank: e.rank || c.rank }];
      }),
    });
    const root = clone(ORGTREE);
    for (const e of emps) {
      if (placed.has(e.name)) continue;
      const host = findNode(root, e.team) || findNode(root, e.site === HQ_SITE ? "총괄" : e.site) || root;
      host.children.push({ name: e.name, rank: e.rank, type: "person", children: [] });
    }
    return root;
  })();
  const allSkills = Array.from(new Set(emps.flatMap((e) => e.skills.map((s) => s[0])))).sort((a, b) => a.localeCompare(b, "ko"));
  const skillCatOf = (name) => { for (const e of emps) { const sk = e.skills.find((s) => skEq(s[0], name)); if (sk) return sk[2]; } return null; };
  // 역할은 로그인한 계정에 의해 결정된다 (화면 토글 없음)
  const me = emps.find((e) => e.id === authId) || null;
  const isManager = isMgr(me);
  const meId = authId;
  const canEdit = (e) => isManager || e.id === meId; // 관리자는 전체, 직원은 본인만
  // 직원 모드에선 본인 카드만 노출 (다른 사람 역량 카드 비공개)
  const visible = isManager ? filtered : emps.filter((e) => e.id === meId);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageSafe = Math.min(page, pageCount);
  const paged = isManager ? visible.slice((pageSafe - 1) * PAGE, pageSafe * PAGE) : visible;
  const hasFilter = !!(q.trim() || team !== "전체"); // 검색어·부서 선택
  const showList = true; // 지사 탭으로 이미 범위가 좁혀지므로 목록을 항상 보여준다(부서 전체=전원, 팀 선택=좁힘)
  // 직원은 관리자 전용 페이지 접근 불가 → 마이페이지로
  const activePage = nav;
  // 직원 카드 목록은 skills 페이지(검색 결과)에서만. 마이페이지는 전용 프로필로 렌더.
  const empListToShow = activePage === "skills" && isManager && showList ? paged : []; // 직원 상세 목록은 관리자만
  const PAGE_META = {
    mypage: { ico: "user", eb: "마이페이지", title: me ? `${me.name} 님의 역량` : "마이페이지", sub: "내 역량·강점·성장 기록을 확인하고 직접 관리하세요." },
    org: { ico: "org", eb: "조직도", title: "조직도 · 현재 배치 현황", sub: isManager ? "팀 구조와 현재 투입 현황을 한눈에 — 가용 인원을 보고 배치하세요." : "팀 구조와 지금 누가 어떤 프로젝트에 투입돼 있는지 한눈에." },
    skills: { ico: "chart", eb: "조직 역량", title: "조직의 역량을 한눈에", sub: isManager ? "분야·강점별 분포를 보고, 직원을 검색해 역량을 확인하세요." : "우리 조직에 어떤 역량이 두텁고 어디가 얇은지 한눈에 확인하세요." },
    board: { ico: "board", eb: isManager ? "프로젝트 · AI 매칭" : "프로젝트 보드", title: "프로젝트 보드", sub: isManager ? "AI 매칭으로 적합 인원을 찾고, 프로젝트를 단계별로 운영하세요 — 완료 시 참여자 스킬이 자동 상승합니다." : "프로젝트를 직접 등록하고 단계를 옮겨 운영하세요 — 완료 시 참여자 스킬이 자동 상승합니다." },
  };
  // 프로젝트 보드는 전체 공개(어떤 프로젝트가 진행 중인지 파악). 생성·수정·단계이동은 전직원, 삭제·AI매칭은 관리자만.
  // 프로젝트에는 소속 필드가 없으므로 참여 팀원 다수결로 지사·팀을 판정한다(시드·신규 모두 자동 분류).
  const majorityOf = (p, pick) => {
    const tally = {};
    p.members.forEach((m) => { const e = matchEmp(m); const k = e && pick(e); if (k) tally[k] = (tally[k] || 0) + 1; });
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };
  const projSiteOf = (p) => majorityOf(p, (e) => e.site) || SITES[0];
  const projTeamOf = (p) => majorityOf(p, (e) => e.team);
  const myProjIds = new Set(projects.filter((p) => p.members.some((m) => m.id === meId)).map((p) => p.id)); // 내가 참여한 프로젝트 강조용
  // 보드 범위 — 팀을 직접 고르지 않는다. 프로젝트의 소속 부서는 참여 팀원에서 판정되므로,
  // 직원에게는 "내 부서 보드"를 바로 띄우고, 전사를 봐야 하는 관리자에게만 지사 탭을 남긴다.
  const myTeam = me?.team || "";
  const boardScope = isManager ? boardSite : myTeam; // 화면 제목에 쓰는 현재 범위명
  // 부서 간 협업 프로젝트가 있으므로 "다수결 부서 == 내 팀"으로 자르면 안 된다.
  // 타 부서가 등록했더라도 우리 팀 인원이 한 명이라도 참여하면 우리 보드에 함께 떠야 한다.
  // 또한 조직도 산하 조직도 내 부서다 — 팀장(예: 공공AX1팀)이 산하 팀 프로젝트를 못 보면 보드가 빈 채로 뜬다.
  const isMyOrg = (t) => !!myTeam && !!t && inTeam(myTeam, t);
  const involvesMyTeam = (p) => p.members.some((m) => isMyOrg(matchEmp(m)?.team));
  const boardProjects = isManager
    ? projects.filter((p) => projSiteOf(p) === boardSite)
    : projects.filter((p) => involvesMyTeam(p) || myProjIds.has(p.id));
  // 현재 배치 현황: 직원별로 진행·검토 중인 프로젝트 목록
  const activeByEmp = {};
  projects.forEach((p) => {
    if (!ACTIVE_STAGES.includes(p.status)) return;
    p.members.forEach((m) => { (activeByEmp[m.id] = activeByEmp[m.id] || []).push(p.title); });
  });
  const allocTeams = Array.from(new Set(emps.map((e) => e.team)));
  // 실제 조직 계층: 솔리데오 → 본부/지사(division) → 팀 → 사람. (근무자명단 수정본의 site/bonbu/team 사용)
  const orgDivs = {}; // divKey → { 팀명: [직원…] }
  emps.forEach((e) => {
    const g = (orgDivs[divKeyOf(e)] = orgDivs[divKeyOf(e)] || {});
    (g[e.team] = g[e.team] || []).push(e);
  });
  const divPeople = (obj) => Object.values(obj).reduce((a, arr) => a + arr.length, 0);
  // 대표부서 정렬: 조직 최상위(가장 높은 직급이 속한 부서)를 맨 위로. 같은 급이면 인원 많은 순.
  // 직속/리더십 버킷(총괄=사장, 중부지사 직속=부사장)이 자연히 상단으로 온다.
  const divTopRank = (obj) => Math.min(...Object.values(obj).flat().map((e) => rankIdx(e.rank)));
  const divEntries = Object.entries(orgDivs).sort((a, b) => divTopRank(a[1]) - divTopRank(b[1]) || divPeople(b[1]) - divPeople(a[1]));
  // 조직역량 필터: 선택한 지사에 속한 본부·팀만 노출 (지사 탭으로 1차 분리)
  const siteEmps = emps.filter((e) => (e.site || SITES[0]) === skillSite);
  const siteDivEntries = divEntries.filter(([d]) => siteEmps.some((e) => divKeyOf(e) === d));
  // 계단식 필터. 본사는 대표부서(본부)가 여럿 → 1단 드롭다운으로 고르고, 그 안의 팀을 2단으로 좁힌다.
  // 중부지사는 대표부서가 하나(사업본부)뿐이라 1단 없이 그 부서의 팀을 바로 고른다.
  const isMultiDiv = siteDivEntries.length > 1;
  const skillDivSafe = siteDivEntries.some(([d]) => d === skillDiv) ? skillDiv : "전체"; // 지사 전환 시 방어
  // 팀 목록의 기준 대표부서: 본사는 선택한 본부, 중부지사는 유일한 그 부서
  const activeDiv = isMultiDiv ? skillDivSafe : (siteDivEntries[0]?.[0] || "전체");
  const teamOptions = activeDiv !== "전체"
    ? Object.keys(orgDivs[activeDiv] || {}).sort((a, b) => orgOrderOf(a) - orgOrderOf(b))
    : [];
  const teamSafe = team === "전체" || teamOptions.includes(team) ? team : "전체"; // 대표부서 변경 시 방어
  // 드롭다운 폭 고정용 — 지사(본사/중부지사)를 바꿔도 폭이 같도록 "양쪽 전체"를 사이저에 넣는다.
  // divEntries는 두 지사의 모든 대표부서를 포함하므로, 여기서 전 부서·전 팀명을 뽑아 최장 폭을 CSS가 잡게 한다.
  const allDivLabels = divEntries.map(([d, teamsObj]) => `${d} (${divPeople(teamsObj)})`);
  const allTeamsGlobal = [...new Set(divEntries.flatMap(([, teamsObj]) => Object.keys(teamsObj)))];

  function openNew() { setExText(""); setExErr(""); setExNote(""); setExFile(null); setDraft(blankDraft()); }
  function openEdit(e) {
    setExText(""); setExErr(""); setExNote(""); setExFile(null);
    setDraft({ id: e.id, name: e.name, team: e.team, rank: e.rank, email: e.email || "", phone: e.phone || "", strengths: [...e.strengths], skills: e.skills.map((s) => [...s]), eduText: e.edu.join(", "), projText: e.proj.join(", ") });
  }

  // 추출 결과(r)를 현재 draft에 병합
  const applyExtract = (r) => setDraft((d) => ({
    ...d,
    name: d.name || (r.name || ""),
    skills: [
      ...d.skills.filter((s) => s[0].trim()),
      ...(r.skills || []).map((s) => [s.name, Math.min(5, Math.max(1, Number(s.level) || 3)), CATS.includes(s.category) ? s.category : "도메인", "자동추출"]),
    ],
    strengths: Array.from(new Set([...(d.strengths || []), ...((r.strengths || []).filter((x) => STRENGTHS.includes(x)))])),
    eduText: [d.eduText, ...(r.edu || [])].filter(Boolean).join(", "),
    projText: [d.projText, ...(r.proj || [])].filter(Boolean).join(", "),
  }));

  async function extractFromText() {
    if (!exText.trim() && !exFile) { setExErr("이력 텍스트를 붙여넣거나 파일을 첨부하세요."); return; }
    setExLoading(true); setExErr(""); setExNote("");
    try {
      const instruction = `첨부된 이력서/경력 자료에서 직원 정보를 추출해 아래 JSON으로만 출력하세요. 설명·코드펜스 없이:
{"name":"이름(없으면 빈 문자열)","skills":[{"name":"스킬명","category":"프론트엔드|백엔드|디자인|기획/PM|데이터|AI|도메인 중 하나","level":1부터5사이_정수_추정}],"edu":["교육명"],"proj":["프로젝트명"],"strengths":["협업|문제해결|자기계발|배려|적극성|업무성과 중 해당"]}${exText.trim() ? "\n\n추가 텍스트:\n" + exText : ""}`;
      let content = instruction;
      if (exFile) {
        const block = exFile.kind === "pdf"
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: exFile.data } }
          : { type: "image", source: { type: "base64", media_type: exFile.media, data: exFile.data } };
        content = [block, { type: "text", text: instruction }];
      }
      const res = await fetch("/api/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content }] }),
      });
      if (!res.ok) throw new Error("API 응답 오류: " + res.status);
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const r = JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
      applyExtract(r);
    } catch {
      // API 키 미설정/호출 실패 → 텍스트 기반 목업 추출로 폴백 (데모가 끊기지 않게)
      applyExtract(mockExtract(exText));
      setExNote(exFile && !exText.trim()
        ? "ℹ API 키가 없어 샘플 데이터로 채웠어요. PDF·이미지 내용 인식은 .env에 키를 넣으면 됩니다."
        : "ℹ API 키가 없어 텍스트에서 키워드로 추정해 채웠어요. 확인·보정 후 저장하세요. (.env에 키를 넣으면 실제 AI 인식)");
    } finally { setExLoading(false); }
  }

  function handleFile(f) {
    if (!f) return;
    setExErr("");
    const name = f.name.toLowerCase();
    if (name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => { setExText((t) => (t ? t + "\n" : "") + String(reader.result)); setExFile(null); };
      reader.readAsText(f);
      return;
    }
    const isPdf = name.endsWith(".pdf") || f.type === "application/pdf";
    const isImg = (f.type || "").startsWith("image/");
    if (!isPdf && !isImg) { setExErr("PDF·이미지·TXT 파일을 올려주세요. (docx·hwp는 PDF로 저장 후 첨부)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1];
      setExFile({ name: f.name, kind: isPdf ? "pdf" : "img", media: f.type || "image/png", data: b64 });
    };
    reader.readAsDataURL(f);
  }

  function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    handleFile(f);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(f);
  }

  function saveDraft() {
    const d = draft;
    if (!d.name.trim()) { return; }
    const existing = d.id ? emps.find((e) => e.id === d.id) : null;
    // 소속(site·group)은 폼에 없다. 선택한 팀의 기존 동료에게서 물려받고, 없으면 원래 값을 유지한다.
    // 이 두 값이 비면 조직역량 필터에서 "기타"로 빠지고 보드 지사 판정도 어긋난다.
    const mate = emps.find((e) => e.team === d.team && e.id !== d.id);
    const rec = migrateEmp({
      ...(existing || {}), // portfolio 등 폼에 없는 필드가 수정 시 유실되지 않도록 먼저 펼친다
      id: d.id || "E" + Date.now(), name: d.name.trim(), team: d.team, rank: d.rank.trim() || "사원",
      site: mate?.site ?? existing?.site ?? skillSite, group: mate?.group ?? existing?.group, // 최후 폴백: 현재 지사 탭
      email: (d.email || "").trim(), phone: (d.phone || "").trim(),
      strengths: d.strengths, skills: dedupeBy(d.skills, (s) => s[0]), // 같은 스킬 두 줄 입력 방지
      edu: d.eduText.split(",").map((x) => x.trim()).filter(Boolean),
      proj: d.projText.split(",").map((x) => x.trim()).filter(Boolean),
      activities: existing ? (existing.activities || []) : [],
      visibility: existing ? (existing.visibility || "공개") : "공개",
      photo: existing ? existing.photo : undefined,
    });
    setEmps((prev) => d.id ? prev.map((e) => (e.id === d.id ? rec : e)) : [...prev, rec]);
    if (!d.id) { // 신규 직원: 저장 직후 목록에서 바로 보이게 검색어를 채워줌 (B3)
      goEmp(rec);
      notify(`${rec.name} 님을 추가했어요`);
    } else notify("저장했어요");
    setDraft(null);
  }
  function deleteEmp(id) {
    setEmps((prev) => prev.filter((e) => e.id !== id));
    // 프로젝트 참여자에서도 함께 제거 — 남겨두면 조회되지 않는 유령 멤버가 보드·상세에 계속 뜬다
    setProjects((prev) => prev.map((p) => (p.members.some((m) => m.id === id)
      ? { ...p, members: p.members.filter((m) => m.id !== id) } : p)));
    setDraft(null); setOpen(null);
  }
  const setVisibility = (id, v) => setEmps((prev) => prev.map((e) => (e.id === id ? { ...e, visibility: v } : e)));
  const emailOf = (e) => e.email || `${e.id.toLowerCase()}@solideo.co.kr`;
  function onProfilePhoto(ev, id) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f || !(f.type || "").startsWith("image/")) return;
    // 원본을 그대로 dataURL로 저장하면 localStorage(약 5MB)를 금방 초과한다 → 캔버스로 256px 정사각 축소 후 저장
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const S = 256, c = document.createElement("canvas");
        c.width = S; c.height = S;
        const side = Math.min(img.width, img.height); // 중앙 정사각 크롭
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        const photo = c.toDataURL("image/jpeg", 0.82);
        setEmps((prev) => prev.map((e) => (e.id === id ? { ...e, photo } : e)));
      };
      img.onerror = () => notify("이미지를 읽을 수 없어요", "warn");
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  }

  // 데모 인증: 관리자 계정 admin/admin1234, 직원 계정 = e코드(소문자)/1234. 실제 버전은 서버 인증.
  function credOf(e) { return isMgr(e) ? { id: "admin", pw: "admin1234" } : { id: e.id.toLowerCase(), pw: "1234" }; }
  // 실사용자 데모 계정 (실제 이메일·비밀번호로 로그인) → 해당 직원으로 매핑
  const CUSTOM_LOGINS = { "tjsn0610@solideos.com": { pw: "dbfk0610!!@", empName: "박선우" } };
  function doLogin(ev) {
    if (ev) ev.preventDefault();
    const id = loginId.trim().toLowerCase();
    let acc = null;
    const custom = CUSTOM_LOGINS[id];
    if (custom && custom.pw === loginPw) acc = emps.find((e) => e.name === custom.empName);
    if (!acc) acc = emps.find((e) => { const c = credOf(e); return c.id === id && c.pw === loginPw; });
    if (!acc) { setLoginErr("아이디 또는 비밀번호가 올바르지 않습니다."); return; }
    try {
      if (rememberId) localStorage.setItem(SAVED_ID_KEY, loginId.trim()); else localStorage.removeItem(SAVED_ID_KEY);
      if (autoLogin) localStorage.setItem(AUTH_KEY, acc.id); else localStorage.removeItem(AUTH_KEY);
    } catch { /* 저장 실패 무시 */ }
    setAuthId(acc.id); setLoginPw(""); setLoginErr("");
  }
  function logout() {
    setAuthId(null); setLoginPw(""); setLoginErr(""); setOpen(null);
    try { localStorage.removeItem(AUTH_KEY); } catch { /* 무시 */ }
    setLoginId(lsGet(SAVED_ID_KEY) || ""); // 저장된 아이디는 유지
  }

  // 성장 활동 추가 → 태그한 스킬 Lv +1(최대 5) & 출처 승격, 없던 스킬은 새로 생성
  const toggleActSkill = (nm) => setActForm((f) => ({ ...f, skills: f.skills.includes(nm) ? f.skills.filter((x) => x !== nm) : [...f.skills, nm] }));
  function openAct(id) { setActFor(id); setActForm({ type: "프로젝트", title: "", date: "", desc: "", skills: [], newSkill: "" }); }
  function addActivity(id) {
    const f = actForm;
    if (!f.title.trim()) return;
    // 칩으로 고른 스킬과 직접 입력한 스킬이 같으면 레벨이 두 번 오른다 → 정규화 기준으로 1건만
    const chosen = dedupeBy([...f.skills, ...(f.newSkill.trim() ? [f.newSkill.trim()] : [])], (x) => x);
    if (!chosen.length) return;
    const skillDefs = chosen.map((name) => ({ name, category: "도메인" }));
    setEmps((prev) => prev.map((e) => (e.id === id
      ? applyActivity(e, { type: f.type, title: f.title.trim(), date: f.date.trim(), desc: f.desc.trim(), skillDefs })
      : e)));
    setActFor(null);
    notify(`역량 개발 기록 — ${chosen.join(", ")} 스킬 반영 ▲`, "grow");
  }

  // ── 포트폴리오: 링크 또는 파일(2.5MB 이하, dataURL 저장) 첨부 ──
  function addPfLink(id) {
    const t = pfDraft.title.trim(), u = pfDraft.url.trim();
    if (!t || !u) return;
    const url = /^https?:\/\//i.test(u) ? u : "https://" + u;
    setEmps((prev) => prev.map((e) => (e.id === id ? { ...e, portfolio: [...(e.portfolio || []), { kind: "link", title: t, url }] } : e)));
    setPfDraft(null); notify("포트폴리오 링크를 추가했어요");
  }
  function addPfFile(id, file) {
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) { notify("2.5MB 이하 파일만 첨부할 수 있어요 — 큰 자료는 링크로 등록해주세요", "warn"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setEmps((prev) => prev.map((e) => (e.id === id ? { ...e, portfolio: [...(e.portfolio || []), { kind: "file", title: file.name, url: String(reader.result) }] } : e)));
      notify("파일을 첨부했어요");
    };
    reader.readAsDataURL(file);
  }
  const rmPf = (id, idx) => setEmps((prev) => prev.map((e) => (e.id === id ? { ...e, portfolio: (e.portfolio || []).filter((_, k) => k !== idx) } : e)));
  // 포트폴리오 섹션 (마이페이지·직원 카드 공용)
  const portfolioSec = (e, editable) => (
    <div className="dsec">
      <h4>포트폴리오</h4>
      {(e.portfolio || []).length > 0 && (
        <div className="pfwrap">
          {(e.portfolio || []).map((p, idx) => (
            <span className="pfitem" key={idx}>
              <a href={p.url} target="_blank" rel="noreferrer" download={p.kind === "file" ? p.title : undefined}>
                <Icon name={p.kind === "file" ? "doc" : "link"} size={12} /> {p.title}
              </a>
              {editable && <b className="pfx" title="삭제" onClick={() => rmPf(e.id, idx)}>✕</b>}
            </span>
          ))}
        </div>
      )}
      {!(e.portfolio || []).length && !editable && <span className="aempty">등록된 포트폴리오가 없어요.</span>}
      {editable && (pfDraft && pfDraft.id === e.id ? (
        <div className="pfform">
          <input name="pfTitle" placeholder="제목 (예: 2026 UX 포트폴리오)" value={pfDraft.title} autoFocus onChange={(ev) => setPfDraft((d) => ({ ...d, title: ev.target.value }))} />
          <input name="pfUrl" placeholder="URL (노션·깃허브·비핸스 등)" value={pfDraft.url} onChange={(ev) => setPfDraft((d) => ({ ...d, url: ev.target.value }))} onKeyDown={(ev) => { if (ev.key === "Enter") addPfLink(e.id); }} />
          <button className="ghost" onClick={() => addPfLink(e.id)} disabled={!pfDraft.title.trim() || !pfDraft.url.trim()}>추가</button>
          <button className="ghost" onClick={() => setPfDraft(null)}>취소</button>
        </div>
      ) : (
        <div className="pfadd">
          <button className="ghost actadd pfbtn" onClick={() => setPfDraft({ id: e.id, title: "", url: "" })}><Icon name="link" size={13} /> 링크 추가</button>
          <label className="pffilebtn"><Icon name="clip" size={13} /> 파일 첨부
            <input type="file" accept=".pdf,image/*,.ppt,.pptx,.doc,.docx,.zip" style={{ display: "none" }}
              onChange={(ev) => { addPfFile(e.id, ev.target.files[0]); ev.target.value = ""; }} />
          </label>
        </div>
      ))}
    </div>
  );

  // ── 프로젝트(칸반): 등록 시 참여 기록, "완료" 단계에서 스킬 성장(Lv↑) 반영 ──
  const resetPm = () => { setPmDiv(""); setPmTeam(""); setPmQuery(""); };
  function openProj() { setEvalResult(null); resetPm(); setProjDraft({ title: "", date: "", lead: "", desc: "", skills: [["", "프론트엔드"]], members: [], status: "진행" }); }
  // 매칭 결과 인원 + 선택 역량으로 프로젝트 모달을 채워서 열기 (매칭 → 배정 연결)
  function projFromMatches(found) {
    const skillCat = (name) => { for (const e of emps) { const sk = e.skills.find((s) => skEq(s[0], name)); if (sk) return sk[2]; } return "도메인"; };
    setEvalResult(null); resetPm();
    const r = matchReq();
    // 분야 조건("디자인 작업")은 추천된 팀원들이 그 분야에서 가장 많이 가진 스킬로 바꿔 넣는다
    const catSkills = r.cats.map((c) => {
      const cnt = {};
      found.forEach((e) => e.skills.filter((s) => s[2] === c).forEach((s) => { cnt[s[0]] = (cnt[s[0]] || 0) + 1; }));
      return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
    }).filter((s) => s && !r.skills.some((rs) => skEq(rs, s)));
    const pSkills = [...r.skills, ...catSkills];
    setProjDraft({
      title: "", date: "", lead: me ? me.name : "", desc: req.trim(),
      skills: pSkills.length ? pSkills.map((s) => [s, skillCat(s)]) : [["", "프론트엔드"]],
      members: found.map((e) => e.id), status: "대기",
    });
  }
  // 기존 프로젝트를 수정용으로 모달에 불러옴 (저장 형식 → draft 형식 변환)
  function openEditProj(p) {
    setEvalResult(null); resetPm();
    setProjDraft({
      id: p.id, title: p.title, date: p.date, lead: p.lead, desc: p.desc || "",
      status: p.status, verified: !!p.verified,
      skills: (p.skills && p.skills.length) ? p.skills.map((s) => [s.name, s.category]) : [["", "프론트엔드"]],
      members: p.members.map((m) => m.id),
    });
  }
  const pUpd = (patch) => setProjDraft((d) => ({ ...d, ...patch }));
  const pSetSkill = (i, j, v) => { setEvalResult(null); setProjDraft((d) => { const sk = d.skills.map((s) => [...s]); sk[i][j] = v; return { ...d, skills: sk }; }); };
  const pAddSkill = () => setProjDraft((d) => ({ ...d, skills: [...d.skills, ["", "프론트엔드"]] }));
  const pRmSkill = (i) => { setEvalResult(null); setProjDraft((d) => ({ ...d, skills: d.skills.filter((_, k) => k !== i) })); };
  const pToggleMember = (id) => { setEvalResult(null); setProjDraft((d) => ({ ...d, members: d.members.includes(id) ? d.members.filter((x) => x !== id) : [...d.members, id] })); };

  // 조합 평가: 선정 인원의 역량으로 요구 기술 커버리지·공백·단일의존 리스크를 계산
  function evalComposition() {
    const d = projDraft;
    const members = d.members.map((id) => emps.find((e) => e.id === id)).filter(Boolean);
    const reqs = dedupeBy(d.skills, (s) => s[0]).map((s) => s[0].trim()); // 중복 시 커버리지 행 key 충돌
    if (!members.length) { setEvalResult({ error: "팀원을 먼저 선정하세요." }); return; }
    if (!reqs.length) { setEvalResult({ error: "사용 기술을 입력하면 조합을 평가할 수 있어요." }); return; }
    const coverage = reqs.map((r) => {
      const holders = members
        .map((m) => { const sk = m.skills.find((s) => skEq(s[0], r)); return sk ? { name: m.name, level: sk[1] } : null; })
        .filter(Boolean).sort((a, b) => b.level - a.level);
      return { skill: r, holders };
    });
    const covered = coverage.filter((c) => c.holders.length > 0).length;
    const gaps = coverage.filter((c) => c.holders.length === 0).map((c) => c.skill);
    const solo = coverage.filter((c) => c.holders.length === 1).map((c) => ({ skill: c.skill, who: c.holders[0].name }));
    const score = Math.round((covered / reqs.length) * 100);
    const ranks = {};
    members.forEach((m) => { ranks[m.rank] = (ranks[m.rank] || 0) + 1; });
    const strengths = Array.from(new Set(members.flatMap((m) => m.strengths)));
    const verdict = score >= 80 ? "탄탄한 조합이에요." : score >= 50 ? "쓸 만하지만 보완이 필요해요." : "역량 공백이 커요. 인원 보강을 권장합니다.";
    setEvalResult({ score, total: reqs.length, covered, coverage, gaps, solo, ranks, strengths, count: members.length, verdict });
  }

  // 프로젝트 완료 시 참여 팀원에게 활동 기록 + 스킬 Lv↑ 반영
  // 완료 → 참여자 스킬 성장. 토스트에 실제로 오른 스킬을 보여주려고 변화분(gains)을 돌려준다.
  function completeGrowth(p) {
    const ids = p.members.map((m) => m.id);
    const gains = [];
    for (const e of emps) {
      if (!ids.includes(e.id)) continue;
      const next = applyActivity(e, { type: "프로젝트", title: p.title, date: p.date, skillDefs: p.skills });
      next.skills.forEach((s) => {
        const before = e.skills.find((b) => skEq(b[0], s[0]));
        if (!before) gains.push({ name: e.name, skill: s[0], from: 0, to: s[1] });
        else if (s[1] > before[1]) gains.push({ name: e.name, skill: s[0], from: before[1], to: s[1] });
      });
    }
    setEmps((prev) => prev.map((e) => {
      if (!ids.includes(e.id)) return e;
      const next = applyActivity(e, { type: "프로젝트", title: p.title, date: p.date, skillDefs: p.skills });
      return { ...next, proj: (next.proj || []).includes(p.title) ? next.proj : [...next.proj, p.title] };
    }));
    return gains;
  }
  const growMsg = (title, n, gains) => {
    // 대표 사례는 "신규 습득"보다 "기존 스킬 Lv 상승"을, 그중에서도 높은 레벨 도달을 우선
    const g = [...gains].sort((a, b) => (b.from > 0) - (a.from > 0) || b.to - a.to)[0];
    const ex = g ? ` · ${g.name} ${g.skill} ${g.from ? "Lv" + g.from + "→" + g.to : "신규 Lv" + g.to}${gains.length > 1 ? ` 외 ${gains.length - 1}건` : ""}` : "";
    return `✓ ${title ? title + " " : ""}완료 — 팀원 ${n}명 스킬 성장 ▲${ex}`;
  };

  function saveProject() {
    const d = projDraft;
    if (!d.title.trim() || !d.members.length) return;
    const skills = dedupeBy(d.skills, (s) => s[0]).map((s) => ({ name: s[0].trim(), category: s[1] })); // 중복 기술 방지
    const wasVerified = !!d.verified; // 수정 전 검증(완료) 여부 — 성장 중복 방지
    const rec = {
      id: d.id || ("P" + Date.now()), title: d.title.trim(), date: d.date.trim(), lead: d.lead.trim(), desc: d.desc.trim(),
      skills, status: d.status, verified: wasVerified || d.status === "완료",
      members: d.members.map((id) => { const e = emps.find((x) => x.id === id); return { id, name: e ? e.name : id }; }),
    };
    if (d.id) setProjects((prev) => prev.map((p) => (p.id === d.id ? rec : p))); // 수정: 제자리 갱신
    else setProjects((prev) => [rec, ...prev]);                                  // 신규: 맨 앞 추가
    if (rec.status === "완료" && !wasVerified) notify(growMsg("", rec.members.length, completeGrowth(rec)), "grow");
    else notify(d.id ? "프로젝트를 수정했어요" : "프로젝트를 생성했어요 — 보드에 추가됨");
    setProjDraft(null);
  }

  // 칸반 단계 이동. "완료"에 처음 도달할 때만 스킬 성장 반영(중복 방지)
  function moveProject(id, status) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setProjects((prev) => prev.map((x) => (x.id === id ? { ...x, status, verified: x.verified || status === "완료" } : x)));
    if (status === "완료" && !p.verified) notify(growMsg(p.title, p.members.length, completeGrowth(p)), "grow");
  }
  function deleteProject(id) { setProjects((prev) => prev.filter((p) => p.id !== id)); }

  const upd = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setSkill = (i, j, v) => setDraft((d) => { const sk = d.skills.map((s) => [...s]); sk[i][j] = v; return { ...d, skills: sk }; });
  const addSkill = () => setDraft((d) => ({ ...d, skills: [...d.skills, ["", 3, "프론트엔드", "자기평가"]] }));
  const rmSkill = (i) => setDraft((d) => ({ ...d, skills: d.skills.filter((_, k) => k !== i) }));
  const toggleStr = (s) => setDraft((d) => ({ ...d, strengths: d.strengths.includes(s) ? d.strengths.filter((x) => x !== s) : [...d.strengths, s] }));

  return (
    <div className={"wrap" + (dark ? " dark" : "")}>
      {/* 로그인 화면(상단바 없음)에서는 우상단 고정 토글. 로그인 후에는 상단바 안에 배치(정렬). */}
      {!me && (
        <button className="themetoggle" onClick={() => setDark((d) => !d)} title={dark ? "라이트 모드" : "다크 모드"} aria-label="테마 전환">
          {dark ? "☀" : "☾"}
        </button>
      )}
      <style>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
        * { box-sizing:border-box; }
        /* 라이트 테마(기본). 모든 색은 변수로 — 다크는 .wrap.dark에서 값만 교체한다. */
        .wrap { --bg:#EEF2F8; --surface:#fff; --surface-2:#F6F8FB; --hover:#F1F4F8; --field:#FBFCFD;
          --ink:#0E1A2E; --ink-soft:#3A485C; --muted:#64748B; --line:#E4E9F2; --line-strong:#C7D0DD;
          --primary:#C4164D; --primary-deep:#9E0F3D; --primary-soft:#FCE7EE;
          --accent:#0FB5AE; --accent-soft:#E2F6F4; --gold:#B8841A; --gold-soft:#FBF3DE;
          --grad-top:#E7ECF7; /* 배경 그라데이션 상단 */
          --shadow-sm:0 1px 2px rgba(14,26,46,.04), 0 8px 24px -14px rgba(14,26,46,.12);
          --shadow-md:0 2px 4px rgba(14,26,46,.05), 0 16px 40px -18px rgba(14,26,46,.16);
          font-family:'Pretendard',system-ui,sans-serif;
          background:radial-gradient(1200px 480px at 50% -180px, var(--grad-top) 0%, var(--bg) 70%); color:var(--ink);
          min-height:100vh; padding:0; line-height:1.55; overflow-x:clip; /* hidden이면 .wrap이 스크롤 컨테이너가 돼 헤더·사이드바 sticky가 깨진다 */ transition:background .25s, color .25s; }
        /* 다크 테마 — 변수 값만 어두운 세트로 교체하면 앱 전체가 전환된다 */
        .wrap.dark { --bg:#0E1420; --surface:#18202E; --surface-2:#1E2735; --hover:#26303F; --field:#141B27;
          --ink:#E7EDF5; --ink-soft:#C6D2E2; --muted:#94A3B8; --line:#2A3546; --line-strong:#3B4757;
          --primary:#F0417A; --primary-deep:#D6215C; --primary-soft:#3A1522;
          --accent:#2CD0C8; --accent-soft:#0F2E2C; --gold:#DBA93E; --gold-soft:#332810;
          --grad-top:#182234;
          --shadow-sm:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -14px rgba(0,0,0,.5);
          --shadow-md:0 2px 4px rgba(0,0,0,.45), 0 16px 40px -18px rgba(0,0,0,.6); }
        /* 테마 토글 — 우상단 고정 */
        .themetoggle { position:fixed; top:14px; right:16px; z-index:200; width:42px; height:42px; border-radius:50%;
          display:flex; align-items:center; justify-content:center; font-size:19px; line-height:1; cursor:pointer;
          background:var(--surface); color:var(--gold); border:1.5px solid var(--line-strong); box-shadow:var(--shadow-md); transition:transform .15s, background .2s, color .2s, border-color .2s; }
        .themetoggle:hover { transform:translateY(-1px) scale(1.06); border-color:var(--primary); color:var(--primary); }
        /* 다크: 페이지보다 밝은 원 + 노란 해 아이콘으로 눈에 띄게 */
        .wrap.dark .themetoggle { background:var(--surface-2); color:#FFCB47; border-color:var(--line-strong); }
        /* 상단바 안 인라인 토글 — 고정 해제하고 로그아웃 버튼과 같은 줄에 정렬 */
        .themetoggle.inbar { position:static; width:38px; height:38px; font-size:17px; flex-shrink:0; box-shadow:none; }
        /* 하드코딩 밝은 배경이 남은 곳 다크 보정 */
        .wrap.dark .topbar { background:rgba(20,27,39,.86); }
        .wrap.dark .prof-top { background:linear-gradient(180deg,#221826,var(--surface) 90%); }
        .wrap.dark .ai-card { background:linear-gradient(160deg,#141E30,var(--surface) 60%); border-color:var(--line); }
        .wrap.dark .match.top { background:linear-gradient(180deg,var(--gold-soft),var(--surface) 90%); }
        .wrap.dark .sitetab:hover:not(.on) { background:rgba(255,255,255,.08); }
        /* 틴트 알림 박스 — 다크에선 어두운 틴트 + 밝은 텍스트 */
        .wrap.dark .privnote { color:#A6D8B8; background:#12281C; border-color:#254A34; }
        .wrap.dark .mengine.local { color:#E0C98A; background:#2A2410; border-color:#4A3F1E; }
        .wrap.dark .mengine.ai { color:#B4ACEC; background:var(--surface-2); border-color:var(--line); }
        /* 카테고리 라벨은 인라인 색(색상 코딩)이라, 다크에선 밝기만 올려 대비 확보(색상 유지) */
        .wrap.dark .bn { filter:brightness(1.5) saturate(1.05); }
        .inner { max-width:960px; margin:0 auto; }
        /* 세련된 스크롤바 (webkit) */
        .wrap ::-webkit-scrollbar { width:9px; height:9px; }
        .wrap ::-webkit-scrollbar-track { background:transparent; }
        .wrap ::-webkit-scrollbar-thumb { background:var(--line-strong); border-radius:99px; border:2px solid transparent; background-clip:padding-box; }
        .wrap ::-webkit-scrollbar-thumb:hover { background:#A9B6C8; background-clip:padding-box; border:2px solid transparent; }
        .applayout { display:flex; align-items:stretch; min-height:100vh; }
        .sidebar { position:sticky; top:0; align-self:flex-start; width:236px; height:100vh; background:var(--surface); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:22px 16px 18px; flex-shrink:0; }
        .sb-brand { display:flex; align-items:flex-end; gap:9px; padding:4px 6px 24px; }
        .sb-logo { height:22px; width:auto; object-fit:contain; }
        .sb-name { font-size:14px; font-weight:800; color:var(--ink); letter-spacing:-.02em; line-height:1; position:relative; top:1px; }
        .sb-nav { display:flex; flex-direction:column; gap:5px; flex:1; }
        .sb-item { display:flex; align-items:center; gap:11px; width:100%; text-align:left; padding:11px 13px; border:0; background:transparent; border-radius:10px; font-size:14px; font-weight:700; color:var(--muted); cursor:pointer; transition:background .15s, color .15s; }
        .sb-item:hover:not(:disabled):not(.on) { background:var(--primary-soft); color:var(--primary); box-shadow:none; }
        .sb-item.on { background:linear-gradient(145deg,var(--primary),var(--primary-deep)); color:#fff; }
        /* 상단 헤더: 흰색 스티키 밴드 — 계정 정보 + 로그아웃 */
        .topbar { position:sticky; top:0; z-index:30; margin:-22px -36px 26px; padding:11px 36px;
          background:rgba(255,255,255,.86); backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
          border-bottom:1px solid var(--line); box-shadow:0 1px 2px rgba(14,26,46,.03); }
        .topbar-in { max-width:980px; margin:0 auto; display:flex; align-items:center; justify-content:flex-end; gap:10px; }
        .tb-uinfo { display:flex; flex-direction:column; line-height:1.3; min-width:0; margin-right:6px; }
        .tb-uinfo b { font-size:13px; font-weight:800; } .tb-uinfo small { font-size:10.5px; color:var(--muted); white-space:nowrap; }
        .tb-logout { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; font-size:12.5px; color:var(--ink-soft); }
        .tb-logout:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); box-shadow:none; }
        .appmain { flex:1; min-width:0; padding:22px 36px 110px; }
        .appmain-inner { max-width:980px; margin:0 auto; animation:pagein .28s cubic-bezier(.22,.9,.36,1); }
        @keyframes pagein { from { opacity:0; transform:translateY(7px); } to { opacity:1; transform:none; } }
        @media (max-width:760px){
          .applayout { flex-direction:column; }
          .sidebar { width:auto; height:auto; position:static; flex-direction:row; align-items:center; border-right:0; border-bottom:1px solid var(--line); padding:11px 14px; gap:10px; }
          .sb-brand { padding:0; flex-shrink:0; }
          /* min-width:0 없으면 flex 자식이 콘텐츠 폭까지 팽창해 overflow-x:auto가 무력화되고 페이지가 가로로 넘친다 */
          .sb-nav { flex-direction:row; flex:1; min-width:0; gap:2px; margin:0 8px; overflow-x:auto; scrollbar-width:none; }
          .sb-nav::-webkit-scrollbar { display:none; }
          .sb-item { white-space:nowrap; padding:9px 11px; flex-shrink:0; }
          .appmain { padding:18px 18px 90px; }
          .topbar { margin:-18px -18px 20px; padding:9px 18px; }
          .tb-uinfo small { display:none; }
        }
        .eyebrow { font-size:11.5px; letter-spacing:.18em; font-weight:800; color:var(--primary); text-transform:uppercase; margin-bottom:10px; display:inline-flex; align-items:center; gap:6px; }
        h1 { font-size:32px; font-weight:800; margin:0 0 9px; letter-spacing:-.03em; line-height:1.16; }
        .sub { color:var(--muted); font-size:15px; margin:0 0 26px; max-width:640px; line-height:1.6; }
        .card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:18px; box-shadow:var(--shadow-sm); }
        .ctitle { display:flex; align-items:center; gap:8px; }
        .scopetag { font-size:12px; font-weight:700; color:var(--primary); background:var(--primary-soft, #FBEAF0); border-radius:20px; padding:2px 11px; }
        .insight { font-size:13px; color:var(--ink); background:var(--surface-2); border:1px solid #DEE9FA; border-radius:10px; padding:10px 13px; margin:2px 0 14px; line-height:1.5; }
        .insight-act { color:var(--primary); font-weight:700; }
        /* 토스트: 하단 중앙, 자동 소멸 */
        .toast { position:fixed; left:50%; bottom:34px; transform:translateX(-50%); z-index:120; background:#1D2A3F; color:#fff;
          font-size:13.5px; font-weight:700; padding:12px 22px; border-radius:12px; box-shadow:0 10px 32px -8px rgba(10,18,34,.45);
          animation:toastin .22s cubic-bezier(.22,.9,.36,1); white-space:nowrap; max-width:88vw; overflow:hidden; text-overflow:ellipsis; }
        .toast.grow { background:linear-gradient(145deg,#1F7A4D,#166B41); }
        .toast.warn { background:linear-gradient(145deg,var(--primary),var(--primary-deep)); }
        @keyframes toastin { from { opacity:0; transform:translate(-50%, 10px); } to { opacity:1; transform:translate(-50%, 0); } }
        .ctitle::before { content:""; width:4px; height:16px; border-radius:3px; background:linear-gradient(var(--primary),var(--primary-deep)); flex-shrink:0; }
        .ai-card { background:linear-gradient(160deg,#EEF2FF,#fff 60%); border-color:#D9E2FA; box-shadow:var(--shadow-md); }
        .reqsec { margin-bottom:13px; }
        .reqlabel { font-size:12.5px; font-weight:700; color:var(--muted); margin-bottom:7px; }
        .reqopt { font-weight:600; color:var(--muted); }
        .reqtags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
        .reqtag { font-size:12.5px; font-weight:700; color:#fff; background:var(--primary); border-radius:20px; padding:5px 11px; cursor:pointer; }
        .reqtag b { font-weight:800; opacity:.8; }
        .skillsearch { width:100%; border:1px solid var(--line); border-radius:10px; padding:10px 13px; font-size:14px; background:var(--surface); }
        .skillopts { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
        .skillopt { font-size:12.5px; font-weight:700; border:1px solid var(--line); background:var(--surface); color:var(--ink); border-radius:8px; padding:6px 11px; }
        .skillopt:hover { border-color:var(--primary); background:var(--surface-2); }
        .skillnone { font-size:12.5px; color:var(--muted); padding:4px 2px; }
        .label { font-size:12.5px; font-weight:800; margin-bottom:9px; display:block; color:var(--ink-soft); letter-spacing:.01em; }
        .labelicon { display:flex; align-items:center; gap:7px; color:var(--primary); }
        .ctitle { font-size:16px; font-weight:800; margin:0 0 6px; letter-spacing:-.015em; }
        .chint { font-size:13px; color:var(--muted); margin:0 0 18px; line-height:1.6; }
        textarea,input,select { font-family:inherit; color:var(--ink); background:var(--field); } /* 배경 미지정 인풋의 기본값도 테마 대응 */
        textarea::placeholder,input::placeholder { color:var(--muted); }
        textarea { width:100%; min-height:74px; resize:vertical; border:1px solid var(--line); border-radius:10px; padding:12px 13px; font-size:14px; line-height:1.6; background:var(--field); }
        textarea:focus,input:focus,select:focus { outline:none; border-color:var(--primary) !important; box-shadow:0 0 0 3px rgba(196,22,77,.13); }
        button { font-family:inherit; font-weight:700; font-size:14px; cursor:pointer; border-radius:10px; padding:11px 18px; border:1px solid var(--line); background:var(--surface); color:var(--ink); transition:.15s; }
        button:active:not(:disabled) { transform:scale(.985); }
        button:hover:not(:disabled){ border-color:var(--muted); box-shadow:var(--shadow-sm); }
        button.primary { background:linear-gradient(145deg,var(--primary),var(--primary-deep)); color:#fff; border:0; box-shadow:0 2px 8px rgba(196,22,77,.28); background-clip:padding-box; }
        button.primary:hover:not(:disabled){ filter:brightness(1.07); box-shadow:0 4px 14px rgba(196,22,77,.34); }
        button.ghost { background:transparent; box-shadow:none; }
        button.ghost:hover:not(:disabled){ background:var(--surface); }
        button.danger { color:#C0392B; border-color:#EAC6C2; }
        button:disabled { opacity:.5; cursor:default; }
        .err { color:#C0392B; font-size:13.5px; margin-top:11px; }
        .row { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; align-items:center; }
        .match { border:1px solid #D5E0F7; border-radius:14px; padding:15px 17px; margin-top:12px; background:var(--surface); box-shadow:var(--shadow-sm); }
        .match.top { border-color:var(--gold); background:linear-gradient(180deg,var(--gold-soft),#fff 75%); }
        .mhead { display:flex; align-items:center; gap:10px; }
        .mname { font-size:16px; font-weight:800; } .mteam { font-size:12.5px; color:var(--muted); }
        .score { margin-left:auto; font-size:13px; font-weight:800; color:var(--primary); font-variant-numeric:tabular-nums; }
        .match.top .score { color:var(--gold); }
        .mreason { font-size:13.5px; color:var(--ink-soft); margin-top:9px; line-height:1.6; }
        .mreason-tag { display:inline-block; font-size:11.5px; font-weight:800; color:var(--primary); background:var(--primary-soft); padding:1px 8px; border-radius:6px; margin-right:7px; vertical-align:1px; }
        .mchips { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
        .mchip { font-size:11.5px; font-weight:700; padding:3px 9px; border-radius:99px; background:var(--accent-soft); color:var(--accent); }
        .mchip b { font-weight:800; }
        .mchip.str { background:var(--primary-soft); color:var(--primary); }
        .mcalc { font-size:12px; color:var(--muted); margin-top:8px; line-height:1.6; }
        .mcalc b { color:var(--ink-soft); font-weight:800; }
        .mcalc .miss { color:#B0A3AB; } .mcalc .miss b { color:#B0A3AB; }
        .mcalc-tag { display:inline-block; font-size:10.5px; font-weight:800; color:var(--muted); border:1px solid var(--line-strong); border-radius:5px; padding:0 6px; margin-right:7px; vertical-align:1px; }
        .mcalc .mcalc-total { color:var(--primary); }
        .scorerule { margin-top:10px; border:1px solid var(--line); border-radius:12px; background:var(--surface-2); padding:9px 14px; font-size:13px; color:var(--ink-soft); }
        .scorerule summary { cursor:pointer; font-weight:700; color:var(--ink); }
        .scorerule ul { margin:8px 0 2px; padding-left:18px; line-height:1.7; }
        .scorerule .rule-note { color:var(--muted); list-style:none; margin-left:-18px; margin-top:4px; font-size:12.5px; }
        .rule-badge { display:inline-block; margin-left:8px; font-size:11px; font-weight:800; color:var(--gold); background:var(--gold-soft); border-radius:6px; padding:1px 7px; vertical-align:1px; }
        .ruleedit { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; margin-top:10px; padding-top:10px; border-top:1px dashed var(--line-strong); }
        .ruleedit-title { font-size:12px; font-weight:800; color:var(--primary); }
        .ruleedit label { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--ink-soft); }
        .ruleedit input { width:64px; padding:5px 8px; font-size:13px; font-weight:700; color:var(--ink); background:var(--field); border:1px solid var(--line-strong); border-radius:8px; outline:none; }
        .ruleedit input:focus { border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft); }
        .ruleedit button { padding:5px 12px; font-size:12px; }
        .ruleedit-hint { flex-basis:100%; font-size:11.5px; color:var(--muted); }
        .charts { display:grid; grid-template-columns:1fr 1fr; gap:26px; }
        @media (max-width:640px){ .charts { grid-template-columns:1fr; gap:20px; } }
        .brow { display:flex; align-items:center; gap:10px; margin-bottom:9px; font-size:13px; }
        .brow .bn { width:74px; font-weight:700; flex-shrink:0; }
        .btrack { flex:1; height:10px; background:var(--hover); border-radius:99px; overflow:hidden; }
        .btrack > span { display:block; height:100%; border-radius:99px; transition:width .5s cubic-bezier(.22,.9,.36,1); }
        .brow .bv { width:30px; text-align:right; font-weight:800; color:var(--ink); font-variant-numeric:tabular-nums; }
        .filters { display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
        input.search { flex:1 1 180px; min-width:150px; border:1px solid var(--line); border-radius:10px; padding:10px 13px; font-size:14px; background:var(--surface); } /* 드롭다운이 늘지 않으니 남는 폭 전부 검색창 */
        .chips { display:flex; gap:6px; flex-wrap:wrap; }
        .tchip { font-size:12.5px; font-weight:700; padding:6px 12px; border-radius:20px; border:1px solid var(--line); background:var(--surface); color:var(--muted); cursor:pointer; }
        .tchip.on { background:var(--ink); color:#fff; border-color:var(--ink); }
        .count-line { display:flex; align-items:center; gap:12px; font-size:13px; color:var(--muted); margin-bottom:10px; }
        .count-line button { padding:8px 14px; font-size:13px; }
        .count-line button:first-of-type { margin-left:auto; }
        .sortsel { font-family:inherit; font-size:13px; border:1px solid var(--line); border-radius:10px; padding:9px 11px; background:var(--surface); color:var(--ink); }
        .sortsel.wideselect { max-width:230px; } /* 본부·팀 통합 드롭다운 — 긴 팀명 대비 */
        .sortsel optgroup { font-style:normal; font-weight:700; color:var(--muted); } /* 브라우저 기본 이탤릭 제거 */
        .sortsel option { font-style:normal; font-weight:500; color:var(--ink); }
        /* 커스텀 드롭다운 — 항상 아래로 열리고 화살표도 브라우저 무관하게 동일 */
        /* 각 트리거는 자기 옵션 중 가장 긴 것에 폭을 맞춘다(사이저). flex로 늘리지 않으므로 남는 폭은 검색창 몫. */
        .dd { position:relative; flex:0 0 auto; min-width:0; }
        .dd-trigger { display:grid; align-items:center; font-family:inherit; font-size:13px; font-weight:600;
          color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:9px 11px; cursor:pointer; }
        /* 사이저와 실제 표시면을 같은 그리드 칸에 겹쳐, 가장 긴 옵션이 트리거 폭을 결정 */
        .dd-sizer, .dd-face { grid-area:1/1; }
        .dd-sizer { height:0; overflow:hidden; visibility:hidden; padding-right:22px; } /* 화살표+간격 폭 확보 */
        .dd-sizer > span { display:block; white-space:nowrap; }
        .dd-face { display:flex; align-items:center; justify-content:space-between; gap:8px; min-width:0; }
        .dd-cur { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dd-trigger:hover { border-color:var(--line-strong); box-shadow:none; }
        .dd[data-open="true"] .dd-trigger, .dd-trigger[aria-expanded="true"] { border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-soft); }
        .dd-ph { color:var(--muted); font-weight:600; } /* 미선택(플레이스홀더) */
        .dd-caret { color:var(--muted); transition:transform .15s; flex-shrink:0; }
        .dd-caret.up { transform:rotate(180deg); }
        .dd-menu { position:absolute; top:calc(100% + 5px); left:0; z-index:50; min-width:100%; max-width:min(280px,90vw); max-height:216px;
          overflow-y:auto; overflow-x:hidden; /* 세로만 스크롤 — 가로 스크롤바 제거, 6~7개 노출 후 스크롤 */
          list-style:none; margin:0; padding:4px; background:var(--surface); border:1px solid var(--line); border-radius:11px;
          box-shadow:0 12px 32px -8px rgba(14,26,46,.22); animation:ddpop .13s ease; }
        @keyframes ddpop { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
        .dd-opt { font-size:13px; color:var(--ink); padding:6px 10px; border-radius:7px; cursor:pointer;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } /* 긴 부서명은 …으로 */
        .dd-opt:hover, .dd-opt.active { background:var(--hover); } /* 키보드 하이라이트 = hover와 동일 */
        .dd-opt.on { color:var(--primary); font-weight:700; background:var(--primary-soft); }
        .dd-menu { min-width:100%; } /* 메뉴는 트리거(=최장 옵션 폭)와 같은 폭부터 시작 */
        .pager { display:flex; align-items:center; justify-content:center; gap:14px; margin-top:14px; }
        .pager button { padding:8px 16px; font-size:13px; }
        .pageinfo { font-size:13px; font-weight:700; color:var(--muted); }
        .emp { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:11px 15px; margin-bottom:7px; cursor:pointer; transition:.12s; }
        .emp:hover { border-color:var(--muted); box-shadow:0 2px 10px #16243b0d; }
        .emp.masked { cursor:default; background:var(--surface-2); }
        .emp.masked:hover { box-shadow:none; border-color:var(--line); }
        .lockbadge { font-size:11px; font-weight:800; color:#8A6D1A; background:var(--gold-soft); border:1px solid #EAD9A8; border-radius:20px; padding:2px 9px; }
        .maskmsg { font-size:12.5px; color:var(--muted); margin-top:9px; padding:9px 11px; background:var(--surface-2); border:1px dashed var(--line); border-radius:9px; }
        /* 마이페이지: 라벨+스위치 설정 행 — 무엇을 공개하는지 명시 */
        .visrow { display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:8px 11px; }
        .visrow-label { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--ink-soft); }
        .switch { position:relative; width:38px; height:21px; border-radius:999px; border:0; padding:0; background:#C9D2DE; transition:background .18s; flex-shrink:0; box-shadow:inset 0 1px 2px rgba(14,26,46,.12); }
        .switch::after { content:""; position:absolute; top:2.5px; left:3px; width:16px; height:16px; border-radius:50%; background:var(--surface); box-shadow:0 1px 3px rgba(14,26,46,.25); transition:left .18s; }
        .switch.on { background:linear-gradient(145deg,var(--primary),var(--primary-deep)); }
        .switch.on::after { left:19px; }
        .switch:hover:not(:disabled) { border:0; box-shadow:inset 0 1px 2px rgba(14,26,46,.12); transform:none; }
        /* 세그먼트 컨트롤: 한 트랙 안에서 선택 — 버튼 2개가 따로 놀지 않게 */
        .vistoggle { display:inline-flex; align-items:center; background:var(--surface-2); border:1px solid var(--line); border-radius:999px; padding:3px; gap:2px; }
        .vistoggle button { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:6px 16px; font-size:12px; font-weight:700; border:0; background:transparent; color:var(--muted); border-radius:999px; box-shadow:none; transition:.15s; white-space:nowrap; }
        .vistoggle button:hover:not(:disabled) { border:0; box-shadow:none; color:var(--ink); background:rgba(255,255,255,.6); transform:none; }
        .vistoggle button.on { background:var(--surface); color:var(--primary); font-weight:800; box-shadow:0 1px 3px rgba(14,26,46,.14); }
        .vistoggle button.on:hover:not(:disabled) { background:var(--surface); color:var(--primary); }
        .visline { display:flex; align-items:center; gap:11px; flex-wrap:wrap; }
        .visstate { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:800; color:#1F7A4D; background:#E8F6EE; border-radius:999px; padding:5px 13px; }
        .visstate.private { color:#8A6D1A; background:var(--gold-soft); }
        .vishint { font-size:12px; color:var(--muted); }
        .mlock { font-size:11px; font-weight:700; color:#8A6D1A; background:var(--gold-soft); border-radius:6px; padding:2px 8px; margin-left:8px; }
        .mload { font-size:11px; font-weight:700; border-radius:6px; padding:2px 8px; margin-left:8px; display:inline-flex; align-items:center; gap:5px; }
        .mload.free { color:#1F7A4D; background:#E8F6EE; } .mload.busy { color:#9A6B00; background:#FBF1DC; } .mload.full { color:#B0203F; background:#FBE7EC; }
        .mengine { font-size:12.5px; padding:8px 12px; border-radius:9px; margin:4px 0 12px; }
        .mengine.ai { color:#2A2370; background:var(--surface-2); border:1px solid #DCE0F5; }
        .mengine.local { color:#5A4A20; background:#FBF7EC; border:1px solid #EFE6CC; }
        .mengine-hint { color:var(--muted); font-weight:500; }
        .m2proj { display:flex; align-items:center; gap:12px; margin-top:14px; padding-top:14px; border-top:1px dashed var(--line); flex-wrap:wrap; }
        .m2proj-hint { font-size:12.5px; color:var(--muted); }
        .privnote { font-size:12px; color:#4A6B52; background:#F0F7F2; border:1px solid #DDEBE1; border-radius:8px; padding:7px 11px; margin:6px 0 10px; }
        .ehead { display:flex; align-items:center; gap:10px; }
        .ename { font-size:15px; font-weight:800; flex-shrink:0; } .erank { font-size:12px; color:var(--muted); font-weight:600; flex-shrink:0; }
        .esum { font-size:12.5px; color:var(--muted); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
        .eteam { margin-left:auto; font-size:12.5px; color:var(--muted); flex-shrink:0; }
        .ecaret { font-size:10px; color:var(--muted); flex-shrink:0; }
        .strchip { font-size:11.5px; font-weight:700; color:var(--muted); background:var(--hover); border:1px solid var(--line); padding:3px 9px; border-radius:20px; }
        .detail { margin-top:13px; padding-top:13px; border-top:1px dashed var(--line); }
        .dsec { margin-bottom:11px; }
        .dsec h4 { font-size:12px; letter-spacing:.04em; color:var(--muted); margin:0 0 7px; font-weight:700; }
        .skrow { display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:13px; }
        .skrow .nm { width:110px; font-weight:700; flex-shrink:0; }
        .skrow .lv { font-size:12px; font-weight:700; color:var(--muted); width:38px; }
        .skrow .src { font-size:11px; color:var(--muted); margin-left:auto; }
        .catbadge { font-size:10.5px; font-weight:800; border-radius:6px; padding:2px 8px; flex-shrink:0; }
        .barr { flex:1; height:7px; background:#EAEFF5; border-radius:20px; overflow:hidden; max-width:200px; }
        .barr > span { display:block; height:100%; background:var(--primary); border-radius:20px; }
        .pill { display:inline-block; font-size:12.5px; background:var(--hover); border:1px solid var(--line); border-radius:7px; padding:4px 9px; margin:0 6px 6px 0; }
        .strwrap .pill { margin:0; } /* strwrap 안에선 gap(6px)만 적용 — 마진 중복 방지 */
        .aempty { font-size:12.5px; color:var(--muted); }
        /* 마이페이지 프로필 */
        .profilecard { padding:0; overflow:hidden; }
        .prof-top { display:flex; align-items:center; gap:22px; padding:26px 26px 24px; background:linear-gradient(180deg,#FBF3F6,#fff 90%); border-bottom:1px solid var(--line); flex-wrap:wrap; }
        .prof-photo { display:flex; flex-direction:column; align-items:center; gap:8px; flex-shrink:0; }
        .prof-photo img, .prof-initial { width:84px; height:84px; border-radius:50%; object-fit:cover; box-shadow:0 4px 14px rgba(196,22,77,.18); }
        .prof-initial { display:flex; align-items:center; justify-content:center; color:#fff; font-size:26px; font-weight:800; }
        .prof-photobtn { font-size:11.5px; font-weight:700; color:var(--primary); cursor:pointer; }
        .prof-photobtn:hover { text-decoration:underline; }
        .prof-info { flex:1; min-width:200px; }
        .prof-namerow { display:flex; align-items:center; gap:10px; }
        .prof-name { font-size:23px; font-weight:800; margin:0; letter-spacing:-.02em; }
        .prof-role { font-size:14px; color:var(--muted); font-weight:600; margin-top:3px; }
        .prof-fields { display:flex; gap:18px; flex-wrap:wrap; margin-top:12px; }
        .pf { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--ink-soft); font-weight:600; }
        .pf svg { color:var(--muted); }
        .prof-side { display:flex; flex-direction:column; align-items:stretch; gap:10px; width:168px; flex-shrink:0; }
        .prof-side .primary { width:100%; }
        .prof-grid { padding:22px 26px 26px; display:grid; grid-template-columns:1fr 1fr; gap:14px 30px; }
        .prof-grid .prof-skills, .prof-grid .prof-acts { grid-column:1 / -1; }
        .prof-grid .dsec { margin-bottom:0; }
        .strwrap { display:flex; gap:6px; flex-wrap:wrap; }
        @media (max-width:680px){ .prof-grid { grid-template-columns:1fr; } .prof-side { align-items:flex-start; } }
        .actgridwrap { display:grid; grid-template-columns:repeat(2, 1fr); gap:7px; align-items:stretch; }
        @media (max-width:680px){ .actgridwrap { grid-template-columns:1fr; } }
        .actrow { display:flex; align-items:center; gap:8px; font-size:12.5px; padding:9px 11px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; box-sizing:border-box; }
        .actrow .acttitle { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .acttype { font-weight:800; flex-shrink:0; font-size:11.5px; border-radius:6px; padding:2px 8px; }
        .acttype.t-프로젝트 { color:#2756D6; background:#EAF0FC; }
        .acttype.t-교육 { color:#8A6D1A; background:var(--gold-soft); }
        .acttype.t-자격증 { color:#B0203F; background:#FBE7EC; }
        .acttype.t-자기계발 { color:#1F7A4D; background:#E8F6EE; }
        .acttitle { font-weight:700; }
        .actdate { color:var(--muted); font-size:11.5px; }
        .actskills { margin-left:auto; display:flex; gap:5px; flex-wrap:wrap; }
        .actrow.clickable { cursor:pointer; transition:background .12s, border-color .12s; }
        .actrow.clickable:hover { background:var(--hover); border-color:var(--line-strong); }
        .actskcount { margin-left:auto; font-size:11px; font-weight:800; color:#1F7A4D; background:#E4F5EA; border-radius:6px; padding:2px 8px; }
        .actsk { font-size:11px; font-weight:700; color:#2E8B57; background:#E4F5EA; border-radius:6px; padding:2px 7px; }
        .actadd { margin-top:4px; padding:8px 13px; font-size:13px; }
        .actempty { display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; padding:22px 16px; background:var(--surface-2); border:1px dashed #D6DEE9; border-radius:12px; }
        .actempty p { margin:0; font-size:13px; color:var(--muted); line-height:1.6; }
        /* 포트폴리오 */
        .pfwrap { display:flex; gap:7px; flex-wrap:wrap; margin-bottom:9px; }
        .pfitem { display:inline-flex; align-items:center; gap:7px; background:var(--surface-2); border:1px solid var(--line); border-radius:9px; padding:6px 11px; font-size:12.5px; font-weight:700; }
        .pfitem a { color:var(--ink-soft); text-decoration:none; display:inline-flex; align-items:center; gap:5px; }
        .pfbtn { display:inline-flex; align-items:center; gap:6px; }
        .pfitem a:hover { text-decoration:underline; color:var(--primary); }
        .pfx { cursor:pointer; color:var(--muted); font-weight:800; font-size:11px; }
        .pfx:hover { color:var(--primary); }
        .pfadd { display:flex; gap:7px; flex-wrap:wrap; align-items:stretch; }
        .pfadd .actadd, .pffilebtn { margin-top:4px; padding:8px 14px; font-size:13px; line-height:1.25; border:1px solid var(--line); border-radius:10px; }
        .pffilebtn { display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:var(--ink); font-weight:700; background:transparent; transition:.15s; }
        .pffilebtn:hover { border-color:var(--muted); box-shadow:var(--shadow-sm); }
        .pfform { display:flex; gap:7px; flex-wrap:wrap; }
        .pfform input { flex:1; min-width:150px; padding:9px 12px; border:1px solid var(--line); border-radius:9px; font-size:13px; background:var(--field); }
        .pfform button { padding:8px 14px; font-size:13px; }
        .actform { background:var(--hover); border:1px solid #D5E0F7; border-radius:10px; padding:13px; margin-top:8px; }
        .actgrid { display:grid; grid-template-columns:.9fr 1.6fr .7fr; gap:7px; margin-bottom:10px; }
        @media (max-width:560px){ .actgrid { grid-template-columns:1fr; } }
        .actform input, .actform select { padding:8px 9px; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--surface); width:100%; }
        .actpicklbl { font-size:12px; font-weight:700; color:var(--muted); margin-bottom:7px; }
        .actnew { margin-top:9px; }
        .rolebar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:11px 14px; margin-bottom:18px; }
        .authwho { font-size:13.5px; } .authwho b { font-weight:800; }
        .avatar.small { width:30px; height:30px; font-size:11px; }
        .acctrole { font-size:11.5px; font-weight:800; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:20px; padding:3px 11px; }
        .acctrole.mgr { color:#fff; background:var(--primary); border-color:var(--primary); }
        .rolehint { font-size:12.5px; color:var(--muted); }
        .rolebar > button { margin-left:auto; padding:8px 14px; font-size:13px; }
        .login { position:relative; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px; overflow:hidden;
          background:linear-gradient(160deg,#F6F3F6 0%,#F1EEF3 100%); }
        .wrap.dark .login { background:linear-gradient(160deg,#0E1420 0%,#141B29 100%); }
        .lgdot, .lgring { position:absolute; border-radius:50%; opacity:.22; }
        .lgdot { width:10px; height:10px; }
        .lgdot1 { background:var(--primary); top:13%; left:9%; width:8px; height:8px; }
        .lgdot2 { background:var(--gold); bottom:16%; left:6%; width:12px; height:12px; }
        .lgdot3 { background:#9C7BD6; top:22%; right:7%; width:11px; height:11px; }
        .lgring { border:2px solid var(--primary); }
        .lgring2 { width:18px; height:18px; bottom:11%; right:13%; border-color:#9C7BD6; }
        .lgd-tc { background:var(--primary); top:8%; left:50%; width:10px; height:10px; }
        .lgr-rm { width:21px; height:21px; top:49%; right:5%; border-color:var(--primary); }
        .lgr-lm { width:20px; height:20px; top:46%; left:9%; border-color:#9C7BD6; }
        .lgd-bc { background:var(--primary); bottom:8%; left:51%; width:11px; height:11px; }
        .lgdot4 { background:var(--gold); top:8%; right:34%; width:9px; height:9px; }
        .loginsplit { position:relative; z-index:1; display:flex; width:100%; max-width:800px; min-height:470px; background:var(--surface); border-radius:18px; box-shadow:0 34px 80px rgba(140,20,60,.16); }
        /* 다크에선 네이비 박스가 배경과 비슷해 안 보이므로, 카드처럼 보더+그림자로 또렷하게 */
        .wrap.dark .loginsplit { border:1px solid var(--line-strong); box-shadow:0 24px 60px -12px rgba(0,0,0,.65); }
        .loginpanel { flex:1.02; padding:46px 42px; display:flex; flex-direction:column; justify-content:center; border-radius:0 18px 18px 0; }
        .loginform { display:flex; flex-direction:column; gap:26px; }
        .ufield label { display:block; font-size:12px; font-weight:600; color:var(--muted); margin-bottom:9px; }
        .ufield input { width:100%; border:none; border-bottom:2px solid #E4DCE1; padding:7px 2px; font-size:15px; background:transparent; transition:.15s; }
        .ufield input:focus { outline:none; border-bottom-color:var(--primary); }
        .loginopts { display:flex; align-items:center; gap:18px; margin-top:-8px; }
        .lcheck { display:inline-flex; align-items:center; gap:7px; font-size:13px; color:var(--muted); font-weight:600; cursor:pointer; user-select:none; }
        .lcheck input { width:15px; height:15px; accent-color:var(--primary); cursor:pointer; outline:none; box-shadow:none; }
        .lcheck input:focus, .lcheck input:focus-visible { outline:none; box-shadow:none; }
        .loginlinks { display:flex; align-items:center; justify-content:center; gap:13px; margin-top:18px; }
        .loginlink { background:none; border:none; padding:2px 4px; font-size:13px; font-weight:600; color:var(--muted); cursor:pointer; }
        .loginlink:hover:not(:disabled) { color:var(--primary); text-decoration:underline; border:none; box-shadow:none; }
        .lldiv { color:var(--muted); font-size:12px; }
        .lnote { font-size:12.5px; color:#7A5560; background:#FBF6F8; border:1px solid #F0E2E8; border-radius:9px; padding:9px 12px; margin-top:14px; line-height:1.55; text-align:center; }
        .loginbtn { display:block; width:100%; margin-top:10px; padding:13px; font-size:14px; border-radius:26px; letter-spacing:.04em; }
        .loginpanel .loginbtn, .loginpanel .loginbtn:hover { box-shadow:none; }
        .democreds { font-size:12.5px; color:var(--muted); margin-top:28px; background:var(--surface-2); border:1px solid var(--line); border-radius:11px; padding:11px 14px; line-height:1.8; }
        .democ-h { font-weight:800; color:var(--ink); margin-bottom:3px; }
        .democreds code { font-size:12px; color:var(--ink); background:var(--field); border:1px solid var(--line); border-radius:5px; padding:1px 6px; }
        .demoreset { margin-top:8px; padding:5px 11px; font-size:11.5px; color:var(--muted); background:transparent; border:1px dashed var(--line-strong); border-radius:8px; }
        .demoreset:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); border-style:dashed; box-shadow:none; }
        .loginbrand { position:relative; flex:1; padding:44px 40px; color:#fff; overflow:hidden; display:flex; flex-direction:column; border-radius:18px 0 0 18px;
          background:linear-gradient(150deg,#D8285F 0%,var(--primary) 50%,#8E1F5E 100%); }
        .lb-logo { height:22px; width:auto; align-self:flex-start; object-fit:contain; position:relative; z-index:2; }
        .lb-grid { position:absolute; top:34px; right:34px; width:78px; height:54px; z-index:1;
          background-image:radial-gradient(rgba(255,255,255,.16) 1.2px, transparent 1.2px); background-size:11px 11px; }
        .lb-wave { position:absolute; inset:0; width:100%; height:100%; z-index:0; }
        .lb-body { margin-top:auto; margin-bottom:auto; position:relative; z-index:2; }
        .lb-body h2 { font-size:38px; font-weight:800; margin:0 0 16px; letter-spacing:-.02em; line-height:1.1; }
        .lb-body p { font-size:13.5px; line-height:1.75; color:rgba(255,255,255,.92); margin:0; }
        .lb-foot { font-size:11.5px; color:rgba(255,255,255,.72); position:relative; z-index:2; }
        @media (max-width:640px){ .loginsplit { flex-direction:column; max-width:420px; } .loginbrand { padding:30px; border-radius:18px 18px 0 0; } .lb-body h2 { font-size:28px; } .loginpanel { padding:34px 28px; border-radius:0 0 18px 18px; } }
        .pstage { display:inline-block; width:100%; margin-top:9px; padding:6px 7px; font-size:12px; font-weight:700; text-align:center; color:var(--muted); background:var(--surface-2); border:1px solid var(--line); border-radius:7px; }
        .orglegend { display:flex; gap:15px; font-size:12px; color:var(--muted); margin:2px 0 16px; flex-wrap:wrap; }
        .orglegend span { display:inline-flex; align-items:center; gap:5px; }
        .ld { width:9px; height:9px; border-radius:50%; display:inline-block; }
        .ld.free { background:#2E8B57; } .ld.busy { background:#C9701C; } .ld.full { background:#C0392B; }
        .orgexpand { margin-left:auto; display:inline-flex; gap:6px; }
        .orgexpand button { padding:5px 11px; font-size:12px; }
        /* 세로 indent 조직도 트리 */
        .orgsearch { display:flex; gap:8px; margin-bottom:10px; }
        .orgsearch input { flex:1; padding:10px 13px; border:1px solid var(--line); border-radius:10px; font-size:13.5px; }
        .orgsearch input:focus { outline:none; border-color:var(--primary); }
        .vempty { color:var(--muted); justify-content:center; font-size:13px; }
        .vtree { border:1px solid var(--line); border-radius:14px; overflow:hidden; }
        .vrow { display:flex; align-items:center; gap:8px; padding:10px 14px; font-size:13.5px; border-bottom:1px solid var(--line); }
        .vrow:last-child { border-bottom:0; }
        .vbm { font-size:14px; }
        .vcount { margin-left:8px; font-size:11.5px; font-weight:700; color:var(--muted); background:var(--hover); border-radius:999px; padding:1.5px 9px; font-variant-numeric:tabular-nums; }
        .vcount.sup { margin-left:5px; color:var(--muted); background:var(--surface-2); font-weight:600; }
        .vn { margin-left:7px; font-size:11.5px; font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums; }
        .vlv0 { font-weight:800; font-size:14.5px; background:var(--surface-2); }
        .vchev { width:14px; color:var(--muted); font-size:11px; flex-shrink:0; }
        .vunit { font-weight:700; color:var(--ink); cursor:pointer; }
        .vunit:hover { background:var(--hover); } .vunit b { font-weight:800; }
        .vperson { background:var(--surface-2); }
        .vperson.vgo { cursor:pointer; }
        .vperson.vgo:hover { background:var(--hover); }
        .vperson.vgo:hover .vpname { color:var(--primary); }
        .vsupport { background:var(--surface-2); }
        .vava { width:24px; height:24px; border-radius:50%; color:#fff; font-size:10px; font-weight:800; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
          background-image:linear-gradient(145deg, rgba(255,255,255,.22), rgba(0,0,0,.08)); background-blend-mode:overlay; box-shadow:inset 0 1px 1px rgba(255,255,255,.25); }
        .vava.sup { width:20px; height:20px; font-size:9px; opacity:.55; }
        .vpname { font-weight:700; } .vsupport .vpname { font-weight:600; color:var(--muted); }
        .vrankb { font-size:11px; font-weight:700; color:var(--muted); }
        .suptag { font-size:10px; font-weight:700; color:var(--muted); background:var(--surface-2); border-radius:6px; padding:1.5px 7px; margin-left:6px; }
        .vperson .ld, .vunit .ld { margin-left:auto; }
        .vload { margin-left:auto; font-size:11px; font-weight:700; border-radius:6px; padding:1.5px 8px; display:inline-flex; align-items:center; gap:5px; }
        .vload .ld { margin-left:0; }
        .vload.busy { color:#9A6B00; background:#FBF1DC; } .vload.full { color:#B0203F; background:#FBE7EC; }
        .boardfilter { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:12px; }
        .sitetabs { display:inline-flex; gap:3px; background:var(--hover); border:1px solid var(--line); border-radius:11px; padding:3px; }
        .sitetabs.pagetabs { display:flex; width:fit-content; margin:16px 0 4px; } /* 페이지 상단(카드 바깥)에 놓일 때 */
        .sitetab { display:inline-flex; align-items:center; gap:6px; font-family:inherit; font-size:13px; font-weight:700; color:var(--muted);
          background:transparent; border:0; border-radius:8px; padding:7px 15px; box-shadow:none; }
        .sitetab:hover:not(.on) { color:var(--ink); background:rgba(255,255,255,.7); box-shadow:none; }
        .sitetab.on { color:#fff; background:var(--primary); box-shadow:0 1px 3px rgba(0,0,0,.12); }
        .sitecount { font-size:11px; font-weight:800; color:var(--muted); background:var(--surface); border-radius:20px; padding:1px 7px; }
        .sitetab.on .sitecount { color:var(--primary); background:rgba(255,255,255,.92); }
        .bscount { display:inline-block; margin-left:8px; font-size:12px; font-weight:800; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:20px; padding:1px 9px; vertical-align:middle; }
        .board { display:grid; grid-template-columns:repeat(auto-fit, minmax(158px, 1fr)); gap:12px; padding-bottom:6px; margin-top:6px; }
        .bcol { min-width:0; background:var(--surface-2); border:1px solid var(--line); border-radius:12px; padding:10px; }
        .bcolhead { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:800; margin-bottom:9px; padding:2px 3px; }
        .bdot { width:9px; height:9px; border-radius:50%; box-shadow:0 0 0 3px rgba(0,0,0,.045); }
        .bcount { margin-left:auto; font-size:12px; font-weight:800; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:20px; padding:1px 8px; }
        .bempty { font-size:12px; color:var(--muted); text-align:center; padding:10px 0; }
        /* hover 감지 영역(pcard-slot)은 고정, 안쪽 카드(pcard)만 뜬다 → 마우스 경계 안 흔들려 덜걱거림 없음 */
        .pcard-slot { margin-bottom:9px; padding-top:2px; }
        .pcard { position:relative; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 12px 11px; overflow:hidden; box-shadow:0 1px 2px rgba(14,26,46,.04); transition:box-shadow .15s, border-color .15s, transform .15s; transform:translateZ(0); backface-visibility:hidden; }
        .pcard-slot:hover .pcard { box-shadow:var(--shadow-md); border-color:var(--line-strong); transform:translate3d(0,-2px,0); }
        .pbar { position:absolute; top:0; left:0; right:0; height:4px; }
        /* 뱃지를 제목과 같은 줄에 두면 제목이 좁은 칸에 갇혀 잘게 줄바꿈된다 → 뱃지는 윗줄, 제목은 카드 폭 전체 */
        .pcardtop { display:block; margin-top:3px; }
        .pcardtitle { display:block; font-size:13px; font-weight:800; line-height:1.4; word-break:keep-all; } /* 제목은 자르지 않는다 — 전부 표시(트렐로 방식), 한국어 어절 단위 줄바꿈 */
        .pcard.clickable { cursor:pointer; }
        /* 참여중 카드는 배경·보더 모두 일반 카드와 동일(흰 배경 + 회색 보더).
           마젠타 보더/링은 hover·선택 상태로 오인돼 걷어냈다 — 참여중 신호는 .minetag 뱃지만 담당한다.
           (.mine 클래스는 마크업에 남아 있으나 의도적으로 스타일을 주지 않는다) */
        /* 참여중·협업 뱃지는 나란히 놓이므로 박스 규격을 공유한다.
           한쪽에만 보더가 있으면 높이가 2px 어긋나 정렬이 틀어진다 → 투명 보더로 높이를 맞춘다 */
        /* 간격은 래퍼의 gap이 전담한다 — 뱃지에 margin을 주면 줄바꿈 시 들여쓰기처럼 어긋난다 */
        .pcardtags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; }
        /* 참여중·협업 뱃지는 나란히 놓이므로 박스 규격을 공유한다.
           한쪽에만 보더가 있으면 높이가 2px 어긋나므로 투명 보더로 높이를 맞춘다 */
        .minetag, .cooptag { display:inline-block; max-width:100%; min-width:0; font-size:10px; line-height:1.6;
          border-radius:5px; padding:1px 6px; border:1px solid transparent; margin:0;
          overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .minetag { font-weight:800; color:#fff; background:var(--primary); border-color:var(--primary); }
        /* 타 부서 주관 협업 건 — 참여중(마젠타)과 구분되도록 중립 톤 */
        .cooptag { font-weight:700; color:var(--muted); background:var(--hover); border-color:var(--line); }
        .minetag.inline, .cooptag.inline { vertical-align:middle; } /* 안내 문구 안 범례 */
        .mine-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--primary); vertical-align:middle; margin-right:5px; }
        /* 프로젝트 상세 팝업 */
        .projview { background:var(--surface); border-radius:18px; width:100%; max-width:440px; padding:24px; box-shadow:0 24px 64px -16px rgba(10,18,34,.4); animation:confpop .18s cubic-bezier(.22,.9,.36,1); }
        .pv-head { display:flex; align-items:flex-start; gap:10px; margin-bottom:10px; }
        .pv-stage { flex-shrink:0; font-size:11px; font-weight:700; color:#fff; border-radius:6px; padding:2px 7px; }
        .pv-head h3 { margin:0; font-size:17px; font-weight:800; line-height:1.35; word-break:keep-all; }
        .pv-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:4px; }
        .pv-meta .pdue, .pv-meta .plead { margin-top:0; margin-right:0; }
        .pv-desc { font-size:13px; color:var(--ink-soft); line-height:1.6; margin:8px 0 4px; }
        .pv-sec { margin-top:14px; }
        .pv-sec h4 { font-size:12px; letter-spacing:.04em; color:var(--muted); margin:0 0 7px; font-weight:700; }
        .pv-members { display:flex; gap:7px; flex-wrap:wrap; }
        .pv-member { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; background:var(--surface-2); border:1px solid var(--line); border-radius:999px; padding:4px 12px 4px 5px; }
        .pv-member small { font-weight:600; color:var(--muted); font-size:11px; }
        .pv-member.go { cursor:pointer; }
        .pv-member.go:hover { border-color:var(--primary); color:var(--primary); background:#FDF4F7; }
        .match.go { cursor:pointer; transition:border-color .15s, box-shadow .15s; }
        .match.go:hover { border-color:var(--primary); box-shadow:var(--shadow-md); }
        .pv-actions { margin-top:20px; }
        .projview .pgrew { margin-top:14px; }
        /* 삭제 확인 팝업 */
        .overlay.confirmoverlay { align-items:center; justify-content:center; }
        .confirmbox { background:var(--surface); border-radius:16px; width:100%; max-width:340px; padding:26px 24px 20px; text-align:center; box-shadow:0 24px 64px -16px rgba(10,18,34,.4); animation:confpop .18s cubic-bezier(.22,.9,.36,1); }
        @keyframes confpop { from { opacity:0; transform:scale(.94); } to { opacity:1; transform:scale(1); } }
        .confirm-ico { width:46px; height:46px; border-radius:50%; background:#FBE7EC; display:flex; align-items:center; justify-content:center; font-size:20px; margin:0 auto 12px; }
        .confirmbox h3 { margin:0 0 8px; font-size:16.5px; font-weight:800; }
        .confirmbox p { margin:0 0 18px; font-size:13.5px; color:var(--ink-soft); line-height:1.6; }
        .confirm-warn { font-size:12px; color:var(--muted); }
        .confirm-actions { display:flex; gap:8px; }
        .confirm-actions button { flex:1; }
        .danger.solid { background:linear-gradient(145deg,var(--primary),var(--primary-deep)); color:#fff; border:0; }
        .danger.solid:hover:not(:disabled) { filter:brightness(1.07); }
        .pdue { display:inline-block; font-size:11px; font-weight:700; color:#C0392B; background:#FDECEA; border-radius:6px; padding:2px 7px; margin-top:7px; margin-right:5px; }
        .plead { display:inline-block; font-size:11px; font-weight:700; color:var(--primary); background:#E7EFFF; border-radius:6px; padding:2px 7px; margin-top:7px; }
        .pavatars { display:flex; flex-wrap:wrap; gap:4px; margin-top:9px; }
        .avatar { width:26px; height:26px; border-radius:50%; color:#fff; font-size:10.5px; font-weight:800; display:inline-flex; align-items:center; justify-content:center;
          background-image:linear-gradient(145deg, rgba(255,255,255,.22), rgba(0,0,0,.08)); background-blend-mode:overlay; box-shadow:inset 0 1px 1px rgba(255,255,255,.25); }
        .pgrew { font-size:10.5px; font-weight:700; color:#2E8B57; background:#E4F5EA; border-radius:6px; padding:3px 7px; margin-top:8px; line-height:1.4; }
        .pmove { width:100%; margin-top:9px; padding:6px 7px; font-size:12px; border:1px solid var(--line); border-radius:7px; background:var(--field); font-family:inherit; color:var(--ink); }
        .pskedit { display:grid; grid-template-columns:1.5fr 1fr auto; gap:7px; margin-bottom:7px; align-items:center; }
        .pskedit input, .pskedit select { padding:8px 9px; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--field); width:100%; }
        .pskedit button { padding:8px 11px; font-size:13px; }
        .recs { display:flex; flex-direction:column; gap:7px; }
        .reccard { display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid var(--line); border-radius:11px; background:var(--surface); }
        .reccard.on { border-color:var(--primary); background:var(--primary-soft); }
        .recinfo { flex:1; min-width:0; }
        .recname { font-size:13.5px; font-weight:800; } .recname small { font-weight:600; color:var(--muted); font-size:11.5px; }
        .recmatch { font-size:11.5px; color:var(--ink-soft); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .recbtn { padding:7px 13px; font-size:12.5px; flex-shrink:0; }
        .pmfilter { display:flex; flex-wrap:wrap; gap:7px; margin-bottom:9px; }
        .field .pmfilter select, .field .pmfilter input { padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:12.5px; background:var(--surface); }
        .field .pmfilter select { flex:1 1 46%; min-width:150px; width:auto; }
        .field .pmfilter input { flex:1 1 100%; width:100%; }
        .pmfilter select:focus, .pmfilter input:focus { outline:none; border-color:var(--primary); }
        .pmselected { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:9px; padding:9px; background:#FBF2F5; border:1px solid #F0DCE3; border-radius:9px; }
        .pmchip { font-size:12px; font-weight:700; padding:4px 9px; border-radius:8px; background:var(--primary); color:#fff; cursor:pointer; }
        .pmchip b { font-weight:800; opacity:.8; margin-left:2px; }
        .pmhint { font-size:12.5px; color:var(--muted); padding:12px; background:var(--surface-2); border-radius:9px; text-align:center; }
        .memberpick { display:flex; gap:7px; flex-wrap:wrap; max-height:230px; overflow-y:auto; }
        .memberpick span { font-size:12.5px; font-weight:700; padding:7px 12px; border-radius:10px; border:1px solid var(--line); cursor:pointer; color:var(--ink); background:var(--field); }
        .memberpick span small { font-weight:600; color:var(--muted); font-size:11px; }
        .memberpick span.on { background:var(--primary); color:#fff; border-color:var(--primary); }
        .memberpick span.on small { color:#D5E0F7; }
        .pmmore { font-size:12px; color:var(--muted); align-self:center; padding:7px 4px; border:0 !important; background:none !important; }
        .evalbtn { width:100%; border-style:dashed; border-color:var(--muted); color:var(--primary); }
        .evalbtn:hover { background:#EEF4FF; }
        .evalerr { font-size:13px; color:var(--muted); margin-top:10px; }
        .evalbox { margin-top:11px; background:var(--surface-2); border:1px solid var(--line); border-radius:11px; padding:14px; }
        .evalhead { display:flex; align-items:center; gap:10px; }
        .evalscore { font-size:14px; font-weight:800; border-radius:20px; padding:4px 12px; }
        .evalscore.good { color:#2E8B57; background:#E4F5EA; }
        .evalscore.mid { color:#C9701C; background:#FFEEDC; }
        .evalscore.bad { color:#C0392B; background:#FDECEA; }
        .evalverdict { font-size:13.5px; font-weight:700; }
        .evalsub { font-size:12.5px; color:var(--muted); margin:8px 0 10px; }
        .evalcov { display:flex; flex-direction:column; gap:5px; }
        .covrow { display:flex; align-items:center; gap:8px; font-size:12.5px; flex-wrap:wrap; }
        .covskill { font-weight:800; min-width:140px; }
        .covskill.no { color:#C0392B; }
        .covby { color:var(--muted); }
        .evalwarn { font-size:12.5px; font-weight:700; border-radius:8px; padding:8px 11px; margin-top:9px; line-height:1.5; }
        .evalwarn.gap { color:#C0392B; background:#FDECEA; }
        .evalwarn.risk { color:#C9701C; background:#FFEEDC; }
        .evalmeta { font-size:12px; color:var(--muted); margin-top:10px; padding-top:9px; border-top:1px solid var(--line); }
        .spin { display:inline-block; width:14px; height:14px; border:2px solid #ffffff80; border-top-color:#fff; border-radius:50%; animation:sp .7s linear infinite; vertical-align:-2px; margin-right:7px; }
        @keyframes sp { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion:reduce){ .spin{ animation:none; } }
        .note { font-size:13px; color:var(--muted); background:var(--surface-2); border:1px solid var(--line); border-radius:10px; padding:11px 14px; margin-bottom:18px; line-height:1.6; }
        .overlay { position:fixed; inset:0; background:rgba(14,22,38,.55); backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px); display:flex; align-items:flex-start; justify-content:center; padding:28px 14px; overflow:auto; z-index:50; }
        .modal { background:var(--surface); border-radius:18px; width:100%; max-width:600px; padding:24px 24px 0; max-height:calc(100vh - 56px); overflow-y:auto; box-shadow:0 24px 64px -16px rgba(10,18,34,.4); }
        .modal h2 { font-size:19px; font-weight:800; margin:0 0 18px; }
        .exbox { background:var(--hover); border:1px solid #D5E0F7; border-radius:12px; padding:14px; margin-bottom:18px; transition:.15s; }
        .exbox.drag { border:2px dashed var(--primary); background:#E7EFFF; }
        .droptip { font-size:12px; color:var(--muted); }
        .dropmsg { margin-top:10px; font-size:13px; font-weight:700; color:var(--primary); text-align:center;
          border:1px dashed #B9C8E6; border-radius:9px; padding:9px; background:var(--surface); }
        .exbox > label { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:800; margin-bottom:8px; color:var(--primary); }
        .exbox textarea { min-height:92px; }
        .exhint { font-size:12px; color:var(--muted); }
        .exnote { font-size:12.5px; color:#1E48BC; background:#E7EFFF; border:1px solid #C9D9F6; border-radius:8px; padding:8px 11px; margin-top:11px; line-height:1.5; }
        .filerow { display:flex; align-items:center; gap:10px; margin:8px 0 2px; flex-wrap:wrap; }
        .filebtn { display:inline-block; font-size:13px; font-weight:700; cursor:pointer; border:1px dashed #B9C8E6; color:var(--primary); background:var(--surface); border-radius:9px; padding:8px 13px; }
        .filebtn:hover { background:#EEF4FF; }
        .fname { font-size:12.5px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:4px 4px 4px 11px; display:inline-flex; align-items:center; gap:4px; }
        .xbtn { padding:2px 7px; font-size:12px; }
        .field { margin-bottom:14px; }
        .field > label { display:block; font-size:12.5px; font-weight:700; color:var(--muted); margin-bottom:6px; }
        .field input, .field select { width:100%; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; background:var(--field); }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .skedit { display:grid; grid-template-columns:1.3fr 1fr .7fr 1fr auto; gap:7px; margin-bottom:7px; align-items:center; }
        .skedit input, .skedit select { padding:8px 9px; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--field); width:100%; }
        .skedit button { padding:8px 11px; font-size:13px; }
        @media (max-width:560px){ .skedit { grid-template-columns:1fr 1fr; } }
        .strpick { display:flex; gap:7px; flex-wrap:wrap; }
        .strpick span { font-size:12.5px; font-weight:700; padding:6px 12px; border-radius:20px; border:1px solid var(--line); cursor:pointer; color:var(--muted); }
        .strpick span.on { background:var(--primary); color:#fff; border-color:var(--primary); }
        .modal-actions { display:flex; gap:10px; margin-top:20px; position:sticky; bottom:0; background:var(--surface); padding:14px 0 24px; border-top:1px solid var(--line); }
        .modal-actions .spacer { flex:1; }
      `}</style>

      {!me && (
        <div className="login">
          <i className="lgdot lgdot1" /><i className="lgdot lgdot2" /><i className="lgdot lgdot3" /><i className="lgring lgring2" />
          <i className="lgdot lgd-tc" /><i className="lgring lgr-lm" /><i className="lgring lgr-rm" /><i className="lgdot lgd-bc" /><i className="lgdot lgdot4" />
          <div className="loginsplit">
            <div className="loginbrand">
              <div className="lb-grid" />
              <svg className="lb-wave" viewBox="0 0 420 620" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 380 C 120 320 180 470 420 410 L420 620 L0 620 Z" fill="rgba(255,255,255,.10)" />
                <path d="M0 470 C 140 430 220 560 420 500 L420 620 L0 620 Z" fill="rgba(255,255,255,.07)" />
              </svg>
              <img className="lb-logo" src="/solideo-logo-white.png" alt="solideo" />
              <div className="lb-body">
                <h2>SoliSkill</h2>
                <p>팀 스킬의 모든 것,<br />한눈에 읽는 우리 조직의 지도.</p>
              </div>
              <div className="lb-foot">SoliSkill — 사내 역량 인벤토리 &amp; AI 인력 매칭</div>
            </div>
            <div className="loginpanel">
              <form className="loginform" onSubmit={doLogin}>
                <div className="ufield">
                  <label htmlFor="loginId">아이디</label>
                  <input id="loginId" name="username" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="admin 또는 r177" autoFocus />
                </div>
                <div className="ufield">
                  <label htmlFor="loginPw">비밀번호</label>
                  <input id="loginPw" name="password" type="password" autoComplete="current-password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)} placeholder="비밀번호" />
                </div>
                <div className="loginopts">
                  <label className="lcheck"><input type="checkbox" checked={rememberId} onChange={(e) => setRememberId(e.target.checked)} /> 아이디 저장</label>
                  <label className="lcheck"><input type="checkbox" checked={autoLogin} onChange={(e) => setAutoLogin(e.target.checked)} /> 자동 로그인</label>
                </div>
                {loginErr && <div className="err">{loginErr}</div>}
                <button className="primary loginbtn" type="submit">로그인</button>
              </form>
              <div className="loginlinks">
                <button type="button" className="loginlink" onClick={() => setHelp((h) => (h === "id" ? null : "id"))}>아이디 찾기</button>
                <span className="lldiv">·</span>
                <button type="button" className="loginlink" onClick={() => setHelp((h) => (h === "pw" ? null : "pw"))}>비밀번호 찾기</button>
              </div>
              {help && <div className="lnote">{help === "id"
                ? "아이디는 관리자가 발급한 직원 ID예요. 모르면 관리자(IT 운영팀)에게 문의하세요. (데모: admin · r177 등)"
                : "비밀번호 재설정은 관리자(IT 운영팀)에게 문의하세요. (데모 계정은 아래 참고)"}</div>}
              <div className="democreds">
                <div className="democ-h">데모 계정</div>
                <div><b>관리자·PM</b> — <code>admin</code> / <code>admin1234</code> (김철 사장)</div>
                <div><b>직원</b> — 직원 ID <code>r177</code>(박선우)·<code>r175</code>(윤승미) 등 / <code>1234</code></div>
                <button type="button" className="demoreset" onClick={() => setConfirmDel({ kind: "reset" })}>🔄 데모 데이터 초기화</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {me && (
      <div className="applayout">
        <aside className="sidebar">
          <div className="sb-brand">
            <img className="sb-logo" src={dark ? "/solideo-logo-white.png" : "/solideo-logo.png"} alt="solideo" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
            <span className="sb-name">SoliSkill</span>
          </div>
          <nav className="sb-nav">
            {MENU.filter((m) => !m.mgr || isManager).map((m) => (
              <button key={m.key} className={"sb-item" + (activePage === m.key ? " on" : "")} onClick={() => { setNav(m.key); if (m.key === "mypage") setOpen(meId); }}>
                <Icon name={m.icon} size={17} /> {m.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="appmain">
          <div className="topbar">
            <div className="topbar-in">
              <span className="avatar small" style={{ background: nameColor(me.name) }}>{me.name.slice(-2)}</span>
              <span className="tb-uinfo"><b>{me.name}</b><small>{me.team} · {me.rank} · {isManager ? "관리자·PM" : "직원"}</small></span>
              <button className="ghost tb-logout" onClick={logout}><Icon name="logout" size={14} /> 로그아웃</button>
              <button className="themetoggle inbar" onClick={() => setDark((d) => !d)} title={dark ? "라이트 모드" : "다크 모드"} aria-label="테마 전환">{dark ? "☀" : "☾"}</button>
            </div>
          </div>
          <div className="appmain-inner" key={activePage}>
            <div className="eyebrow"><Icon name={PAGE_META[activePage].ico} size={13} />{PAGE_META[activePage].eb}</div>
            <h1>{PAGE_META[activePage].title}</h1>
            <p className="sub">{PAGE_META[activePage].sub}</p>
            {activePage === "skills" && isManager && <div className="note">숙련도 기준 — <b>1</b> 배우는 중 · <b>3</b> 혼자 업무 가능 · <b>5</b> 남을 가르칠 수준. 역량은 팀·직급 기반 추정치로 시작하며, 프로젝트 완료·역량 개발 기록으로 자동 갱신됩니다.</div>}
            {/* 지사 탭은 아래 역량 분포·직원 목록 전체를 좌우하므로, 그것들보다 위에 둔다 */}
            {/* 분포는 집계 정보라 직원도 지사를 바꿔 볼 수 있다(개인별 목록은 관리자 전용) */}
            {activePage === "skills" && (
              <div className="sitetabs pagetabs" role="tablist">
                {SITES.map((s) => (
                  <button key={s} role="tab" aria-selected={skillSite === s}
                    className={"sitetab" + (skillSite === s ? " on" : "")}
                    onClick={() => { setSkillSite(s); setSkillDiv("전체"); setTeam("전체"); }}>
                    {s}<span className="sitecount">{emps.filter((e) => (e.site || SITES[0]) === s).length}</span>
                  </button>
                ))}
              </div>
            )}

        {activePage === "mypage" && me && (
        <div className="card profilecard">
          <div className="prof-top">
            <div className="prof-photo">
              {me.photo
                ? <img src={me.photo} alt={me.name} />
                : <span className="prof-initial" style={{ background: nameColor(me.name) }}>{me.name.slice(-2)}</span>}
              <label className="prof-photobtn">사진 변경<input type="file" accept="image/*" onChange={(ev) => onProfilePhoto(ev, me.id)} hidden /></label>
            </div>
            <div className="prof-info">
              <div className="prof-namerow">
                <h2 className="prof-name">{me.name}</h2>
                <span className={"acctrole" + (isManager ? " mgr" : "")}>{isManager ? "관리자·PM" : "직원"}</span>
              </div>
              <div className="prof-role">{me.team} · {me.rank}</div>
              <div className="prof-fields">
                <span className="pf"><Icon name="mail" size={14} />{emailOf(me)}</span>
                <span className="pf"><Icon name="phone" size={13} />{me.phone || "내선/연락처 미등록"}</span>
              </div>
            </div>
            <div className="prof-side">
              <div className="visrow" title="켜면 관리자·PM이 내 역량을 볼 수 있어요. 끄면 비공개(매칭 추천 시에만 공개).">
                <span className="visrow-label"><Icon name={me.visibility === "비공개" ? "lock" : "unlock"} size={12} /> 내 역량 공개</span>
                <button
                  className={"switch" + (me.visibility !== "비공개" ? " on" : "")}
                  role="switch" aria-checked={me.visibility !== "비공개"}
                  onClick={() => setVisibility(me.id, me.visibility === "비공개" ? "공개" : "비공개")}
                />
              </div>
              <button className="primary" onClick={() => openEdit(me)}>내 정보 수정</button>
            </div>
          </div>

          <div className="prof-grid">
            <div className="dsec"><h4>강점</h4><div className="strwrap">{me.strengths.map((s) => <span className="strchip" key={s}>{s}</span>)}</div></div>
            <div className="dsec prof-skills">
              <h4>보유 역량 · 숙련도</h4>
              {me.skills.map((s) => {
                const c = CAT_STYLE[s[2]] || { bg: "var(--hover)", fg: "#5B6B7F" };
                return (
                  <div className="skrow" key={s[0]}>
                    <span className="nm">{s[0]}</span>
                    <span className="catbadge" style={{ background: c.bg, color: c.fg }}>{s[2]}</span>
                    <span className="barr"><span style={{ width: s[1] * 20 + "%", background: c.fg }} /></span>
                    <span className="lv">Lv.{s[1]}</span>
                    <span className="src">{s[3]}</span>
                  </div>
                );
              })}
            </div>
            {portfolioSec(me, true)}
            <div className="dsec prof-acts">
              <h4>역량 개발 — 프로젝트·교육·자격증 이력과 오른 스킬을 한눈에</h4>
              <div className="actgridwrap">
              {(me.activities || []).map((a, ai) => (
                <div className="actrow clickable" key={ai} onClick={() => setActView({ activity: a, empName: me.name })} title="클릭하면 상세 보기">
                  <span className={"acttype t-" + a.type}>{ACT_ICON[a.type]} {a.type}</span>
                  <span className="acttitle">{a.title}</span>
                  {a.date && <span className="actdate">{a.date}</span>}
                  {(a.skills || []).length > 0 && <span className="actskcount">▲ {a.skills.length}</span>}
                </div>
              ))}
              </div>
              {actFor === me.id ? (
                <div className="actform">
                  <div className="actgrid">
                    <select value={actForm.type} onChange={(ev) => setActForm((f) => ({ ...f, type: ev.target.value }))}>{ACT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                    <input value={actForm.title} onChange={(ev) => setActForm((f) => ({ ...f, title: ev.target.value }))} placeholder="활동명 (예: 세움터 개편 프로젝트)" />
                    <input className="actdt" value={actForm.date} onChange={(ev) => setActForm((f) => ({ ...f, date: ev.target.value }))} placeholder="2025-06" />
                  </div>
                  <input className="actnew" value={actForm.desc} onChange={(ev) => setActForm((f) => ({ ...f, desc: ev.target.value }))} placeholder="간략한 설명 (선택, 예: 공공 포털 프론트엔드 구축)" />
                  <div className="actpicklbl">이 활동으로 성장한 스킬 선택 (Lv +1):</div>
                  <div className="strpick">{me.skills.map((s) => <span key={s[0]} className={actForm.skills.includes(s[0]) ? "on" : ""} onClick={() => toggleActSkill(s[0])}>{s[0]}</span>)}</div>
                  <input className="actnew" value={actForm.newSkill} onChange={(ev) => setActForm((f) => ({ ...f, newSkill: ev.target.value }))} placeholder="새로 생긴 스킬 추가 (선택, 예: Docker)" />
                  <div className="row">
                    <button className="primary" onClick={() => addActivity(me.id)}>활동 기록 · 스킬 반영</button>
                    <button className="ghost" onClick={() => setActFor(null)}>취소</button>
                  </div>
                </div>
              ) : (me.activities || []).length === 0 ? (
                <div className="actempty">
                  <p>아직 기록된 이력이 없어요.<br />프로젝트·교육·자격증을 추가하면 관련 스킬이 자동으로 올라가요.</p>
                  <button className="primary" onClick={() => openAct(me.id)}>+ 역량 개발 기록</button>
                </div>
              ) : (
                <button className="ghost actadd" onClick={() => openAct(me.id)}>+ 역량 개발 기록</button>
              )}
            </div>
          </div>
        </div>
        )}

        {activePage === "skills" && (
        <div className="card">
          <div className="ctitle">조직 역량 분포 <span className="scopetag">{distUnit === "전체" ? skillSite : distUnit} 기준 · {distEmps.length}명</span></div>
          <p className="chint">우리 조직에 어떤 역량이 두텁고 어디가 얇은지 한눈에 — 채용·교육 계획의 근거가 됩니다. {team === "전체" ? "아래 부서를 선택하면 해당 조직 기준으로 바뀝니다." : ""}</p>
          {distInsight && distInsight.strong.n > 0 && (
            <div className="insight">💡 <b>{distInsight.scope}</b> — 가장 두터운 분야는 <b>{distInsight.strong.c}({distInsight.strong.n}명)</b>, 가장 얇은 분야는 <b>{distInsight.weak.c}({distInsight.weak.n}명)</b>. <span className="insight-act">{distInsight.weak.c} 역량 보강을 검토하세요.</span></div>
          )}
          <div className="charts">
            <div>
              <div className="label">분야별 보유 인원</div>
              {catDist.map((d) => {
                const c = CAT_STYLE[d.c];
                return (
                  <div className="brow" key={d.c}>
                    <span className="bn" style={{ color: c.fg }}>{d.c}</span>
                    <span className="btrack"><span style={{ width: (d.n / catMax) * 100 + "%", background: c.fg }} /></span>
                    <span className="bv">{d.n}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <div className="label">강점 분포</div>
              {strDist.map((d) => {
                const top = d.n === strMax; // 최고 강점만 브랜드 컬러로 강조
                return (
                  <div className="brow" key={d.s}>
                    <span className="bn" style={top ? { color: "var(--primary)", fontWeight: 800 } : undefined}>{d.s}</span>
                    <span className="btrack"><span style={{ width: (d.n / strMax) * 100 + "%", background: top ? "linear-gradient(90deg,var(--primary),#E24E7E)" : "#B9C4D4" }} /></span>
                    <span className="bv">{d.n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}

        {activePage === "skills" && !isManager && (
          <div className="note">개별 직원의 상세 역량은 <b>관리자·PM만</b> 열람할 수 있어요. 내 역량은 <b>마이페이지</b>에서 관리하세요.</div>
        )}

        {activePage === "org" && (
        <div className="card">
          <div className="ctitle">조직도 · 현재 배치 현황</div>
          <p className="chint">팀 구조와 함께 지금 누가 어떤 프로젝트(진행·검토)에 투입돼 있는지 한눈에. 아바타 테두리 색이 부하 상태예요 — 가용 인원을 보고 배치를 결정하세요.</p>
          <div className="orglegend">
            <span><i className="ld free" /> 가용</span>
            <span><i className="ld busy" /> 투입(1건)</span>
            <span><i className="ld full" /> 풀로드(2건+)</span>
            <span className="orgexpand">
              <button className="ghost" onClick={() => setOrgCollapsed(new Set())}>전체 펼치기</button>
              <button className="ghost" onClick={() => setOrgCollapsed(new Set(ALL_ORG_PATHS))}>전체 접기</button>
            </span>
          </div>
          <div className="orgsearch">
            <input name="orgSearch" value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} placeholder="이름·직급으로 검색 (예: 박선우, 팀장, 본부장)" />
            {orgQuery && <button className="ghost" onClick={() => setOrgQuery("")}>지우기</button>}
          </div>
          <div className="vtree">
            <div className="vrow vlv0"><span className="vbm">🏢</span> {ORGTREE.name} <span className="vcount">정직원 {emps.length} · 협력 {ORG_NSUPPORT}</span></div>
            {(() => {
              const oq = orgQuery.trim().toLowerCase();
              const matchNode = (n) => !oq || [n.name, n.rank].some((v) => (v || "").toLowerCase().includes(oq));
              const hasMatch = (n) => n.type !== "unit" ? matchNode(n) : (n.children || []).some(hasMatch);
              const rows = [];
              const walk = (node, depth, path) => {
                for (const c of node.children || []) {
                  const cp = path + "/" + c.name;
                  const pad = { paddingLeft: 14 + depth * 17 };
                  if (c.type === "unit") {
                    if (oq && !hasMatch(c)) continue;
                    const open = oq ? true : !orgCollapsed.has(cp);
                    rows.push(
                      <div className="vrow vunit" key={cp} style={pad} onClick={() => setOrgCollapsed((s) => { const n = new Set(s); if (n.has(cp)) n.delete(cp); else n.add(cp); return n; })}>
                        {(() => { const { p, s } = orgCount(c); return (<>
                          <span className="vchev">{open ? "▾" : "▸"}</span><span className="vbm">📁</span> <b>{c.name}</b>
                          <span className="vn" title={"정직원 " + p + "명" + (s > 0 ? " · 협력 " + s + "명" : "")}>{p}</span>
                        </>); })()}
                      </div>
                    );
                    if (open) walk(c, depth + 1, cp);
                  } else if (c.type === "support") {
                    if (oq && !matchNode(c)) continue;
                    rows.push(
                      <div className="vrow vsupport" key={cp} style={pad}>
                        <span className="vava sup" style={{ background: nameColor(c.name) }}>{c.name.slice(-2)}</span>
                        <span className="vpname">{c.name}</span><span className="suptag" title="협력업체 인력 — 역량·매칭 대상에서 제외">협력</span>
                      </div>
                    );
                  } else {
                    if (oq && !matchNode(c)) continue;
                    const e = empByName(c.name);
                    const act = e ? (activeByEmp[e.id] || []) : [];
                    const load = act.length === 0 ? "free" : act.length >= 2 ? "full" : "busy";
                    const lbl = act.length === 0 ? null : act.length >= 2 ? `풀로드 ${act.length}` : "투입";
                    const goSkill = isManager && e; // 직원은 개별 역량 열람 불가
                    rows.push(
                      <div className={"vrow vperson" + (goSkill ? " vgo" : "")} key={cp} style={pad}
                        title={(act.join(", ") || "가용") + (goSkill ? " — 클릭하면 역량 보기" : "")}
                        onClick={goSkill ? () => { goEmp(e); } : undefined}>
                        <span className="vava" style={{ background: nameColor(c.name) }}>{c.name.slice(-2)}</span>
                        <span className="vpname">{c.name}</span><span className="vrankb">{c.rank}</span>
                        {lbl ? <span className={"vload " + load}><i className={"ld " + load} />{lbl}</span> : <span className="ld free" title="가용" />}
                      </div>
                    );
                  }
                }
              };
              walk(orgTree, 0, orgTree.name);
              return rows.length ? rows : <div className="vrow vempty">검색 결과가 없어요.</div>;
            })()}
          </div>
        </div>
        )}

        {activePage === "board" && isManager && (
        <div className="card ai-card">
          <label className="label labelicon"><Icon name="match" size={16} /> AI 프로젝트 인력 매칭 — 필요한 역량·강점으로 적합 인원 찾기</label>
          <div className="reqsec">
            <div className="reqlabel">필요 역량 (검색해서 추가)</div>
            {reqSkills.length > 0 && (
              <div className="reqtags">
                {reqSkills.map((s) => <span className="reqtag" key={s} onClick={() => toggleReqSkill(s)}>{s} <b>✕</b></span>)}
              </div>
            )}
            <input className="skillsearch" name="skillSearch" value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)}
              onKeyDown={(e) => { // Enter → 첫 번째 후보 바로 추가 (C3)
                if (e.key !== "Enter") return;
                e.preventDefault();
                const first = allSkills.find((s) => s.toLowerCase().includes(skillQuery.trim().toLowerCase()) && !reqSkills.includes(s));
                if (first) { toggleReqSkill(first); setSkillQuery(""); }
              }}
              placeholder="역량 이름 검색 (예: Vue, Python, Figma) — Enter로 바로 추가" />
            {skillQuery.trim() && (() => {
              const opts = allSkills.filter((s) => s.toLowerCase().includes(skillQuery.trim().toLowerCase()) && !reqSkills.includes(s));
              return (
                <div className="skillopts">
                  {opts.slice(0, 8).map((s) => (
                    <button className="skillopt" key={s} onClick={() => { toggleReqSkill(s); setSkillQuery(""); }}>{s}</button>
                  ))}
                  {opts.length === 0 && <div className="skillnone">일치하는 역량이 없어요</div>}
                </div>
              );
            })()}
          </div>
          <div className="reqsec">
            <div className="reqlabel">필요 강점 (클릭해서 선택)</div>
            <div className="strpick">
              {STRENGTHS.map((s) => <span key={s} className={reqStrengths.includes(s) ? "on" : ""} onClick={() => toggleReqStrength(s)}>{s}</span>)}
            </div>
          </div>
          <div className="reqsec">
            <div className="reqlabel">추가 설명 <span className="reqopt">(선택)</span></div>
            <textarea value={req} onChange={(e) => setReq(e.target.value)} placeholder="예: 6월 착수, 공공 SI 경험 우대 — 자유롭게 보태세요 (비워도 됩니다)" style={{ minHeight: 56 }} />
          </div>
          <div className="privnote">🔒 AI 분석 시 <b>이름·연락처는 외부로 전송되지 않습니다</b> — 요청마다 새로 만든 일회용 익명 ID와 역량만 사용해요.</div>
          <div className="row">
            <button className="primary" onClick={match} disabled={loading}>
              {loading ? <><span className="spin" />{[`${emps.length}명 역량 데이터 정리 중…`, "필요 역량과 이력 대조 중…", "투입·가용 현황 반영 중…", "추천 인원 정리 중…"][Math.min(loadStep, 3)]}</> : "적합 인원 찾기"}
            </button>
            {(reqSkills.length > 0 || reqStrengths.length > 0 || req.trim()) && (
              <button className="ghost" onClick={() => { setReqSkills([]); setReqStrengths([]); setReq(""); setMatches([]); setMatchEngine(null); }}>선택 초기화</button>
            )}
          </div>
          {error && <div className="err">{error}</div>}
          {matches.length > 0 && matchEngine && (
            <div className={"mengine " + matchEngine}>
              {matchEngine === "ai"
                ? <>🤖 <b>AI 분석</b> — Claude가 역량·이력을 종합해 후보와 추천 이유를 골랐어요 · 적합도는 공통 기준으로 계산</>
                : <>📐 <b>규칙 기반</b> — API 키가 없어 선택한 역량 일치도로 계산했어요 <span className="mengine-hint">(.env에 키를 넣으면 AI 분석)</span></>}
            </div>
          )}
          {matches.length > 0 && (
            <details className="scorerule">
              <summary>ⓘ 적합도는 어떻게 계산되나요? — 모든 직원에게 같은 기준{ruleCustom && <span className="rule-badge">조정된 기준</span>}</summary>
              <ul>
                <li>요구 항목(필요 기술·강점)마다 점수를 매겨 <b>평균</b>을 냅니다.</li>
                <li>보유 기술: <b>{scoreRule.base} + 숙련도 × {scoreRule.perLv}</b> (항목당 최고 100) → Lv.1 = {ruleSkillPts(scoreRule, 1)} · Lv.3 = {ruleSkillPts(scoreRule, 3)} · Lv.5 = {ruleSkillPts(scoreRule, 5)}</li>
                <li>강점 일치: <b>{scoreRule.strength}</b> · 미보유 기술·강점: <b>0</b></li>
                <li>분야로 요청하면(예: "디자인 작업") 그 분야에서 <b>가장 숙련된 스킬</b>로 계산합니다.</li>
                <li>동점이면 <b>현재 투입이 적은 사람</b> → 숙련도 합이 높은 사람 → 직급이 낮은 사람(상위 직급 인력 보존) 순</li>
                <li>투입 여부는 점수에 넣지 않고 따로 표시합니다 — 최종 배치 판단은 리더가 합니다.</li>
                <li className="rule-note">초기값({DEFAULT_SCORE_RULE.base}·{DEFAULT_SCORE_RULE.perLv}·{DEFAULT_SCORE_RULE.strength})은 <b>“기술 보유 여부를 숙련도 차이보다 크게 본다”</b>는 원칙으로 팀이 정한 값입니다. 정답이 있는 숫자가 아니므로 조직이 합의해 조정합니다.</li>
              </ul>
              {isManager && (
                <div className="ruleedit">
                  <span className="ruleedit-title">기준 조정 (관리자)</span>
                  <label>보유 기본점 <input type="text" inputMode="numeric" value={scoreRule.base} onChange={(ev) => setRuleField("base", ev.target.value)} /></label>
                  <label>숙련도 1단계당 <input type="text" inputMode="numeric" value={scoreRule.perLv} onChange={(ev) => setRuleField("perLv", ev.target.value)} /></label>
                  <label>강점 일치 <input type="text" inputMode="numeric" value={scoreRule.strength} onChange={(ev) => setRuleField("strength", ev.target.value)} /></label>
                  <button className="ghost" disabled={!ruleCustom} onClick={() => setScoreRule(DEFAULT_SCORE_RULE)}>초기값으로</button>
                  <div className="ruleedit-hint">바꾸면 아래 적합도·계산식·순서가 즉시 다시 계산됩니다. 예: 숙련도를 더 중시하려면 기본점 ↓ · 단계당 점수 ↑</div>
                </div>
              )}
            </details>
          )}
          {/* 기준을 조정하면 순서도 현재 기준의 적합도로 다시 정렬(동점은 기존 순서 유지) */}
          {matches.map((m, i) => ({ m, i, s: cardScore(m) }))
            .sort((a, b) => b.s - a.s || a.i - b.i).map(({ m }, i) => {
            const e = matchEmp(m);
            const act = e ? (activeByEmp[e.id] || []) : [];
            const load = act.length === 0 ? "free" : act.length >= 2 ? "full" : "busy";
            const loadLabel = act.length === 0 ? "가용" : act.length >= 2 ? `풀로드 ${act.length}건` : "투입 1건";
            return (
              <div className={"match" + (i === 0 ? " top" : "") + (e ? " go" : "")} key={(m.id || m.name) + i}
                title={e ? "클릭하면 역량 보기" : undefined}
                onClick={e ? () => { goEmp(e); } : undefined}>
                <div className="mhead">
                  <span className="mname">{e ? e.name : m.name}</span>
                  <span className="mteam">{e ? `${e.team} · ${e.rank}` : ""}</span>
                  {e && <span className={"mload " + load} title={act.join(", ") || "가용"}><i className={"ld " + load} />{loadLabel}</span>}
                  {e && e.visibility === "비공개" && <span className="mlock">🔒 비공개 → 매칭으로 공개</span>}
                  <span className="score">적합도 {cardScore(m)}</span>
                </div>
                <div className="mreason"><span className="mreason-tag">💡 추천 이유</span>{
                  // 규칙 기반 이유는 현재 역량으로 다시 써서, 프로젝트 완료로 Lv가 오른 뒤에도 아래 칩·계산식과 숫자가 맞게 한다
                  matchEngine === "local" && e
                    ? (() => { const r = matchReq(); return explainMatch(e, r.skills, r.skills.filter((rs) => e.skills.some((s) => skEq(s[0], rs))), r.strengths.filter((s) => e.strengths.includes(s)), r.cats); })()
                    : m.reason}</div>
                {e && (() => {
                  // 근거를 눈으로: 요구 역량 중 이 사람이 가진 스킬(숙련도)·강점 칩 + 적합도 계산식
                  const r = matchReq();
                  const sk = [...r.skills.map((rs) => e.skills.find((s) => skEq(s[0], rs))), ...r.cats.map((c) => bestInCat(e, c))].filter(Boolean);
                  const st = r.strengths.filter((s) => e.strengths.includes(s));
                  const bd = scoreBreakdown(e, r.skills, r.strengths, r.cats);
                  return (
                    <>
                      {(sk.length > 0 || st.length > 0) && (
                        <div className="mchips">
                          {sk.map((s) => <span key={s[0]} className="mchip">{s[0]} <b>Lv.{s[1]}</b></span>)}
                          {st.map((s) => <span key={s} className="mchip str">{s}</span>)}
                        </div>
                      )}
                      {bd.items.length > 0 && (
                        <div className="mcalc">
                          <span className="mcalc-tag">계산</span>
                          {bd.items.length > 1 && "( "}
                          {bd.items.map((x, k) => <span key={k} className={x.miss ? "miss" : ""}>{k > 0 && " + "}{x.label} <b>{x.pts}</b></span>)}
                          <span>{bd.items.length > 1 && " )"} ÷ {bd.items.length} = <b className="mcalc-total">{bd.score}</b></span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          })}
          {matches.length > 0 && (() => {
            const found = matches.map(matchEmp).filter(Boolean);
            if (!found.length) return null;
            return (
              <div className="m2proj">
                <button className="primary" onClick={() => projFromMatches(found)}>
                  ＋ 이 {found.length}명으로 프로젝트 만들기
                </button>
                <span className="m2proj-hint">선택한 역량·인원이 채워진 채로 열려요 — 확인·보정 후 저장하세요.</span>
              </div>
            );
          })()}
        </div>
        )}

        {activePage === "board" && (
        <div className="card">
          <div className="count-line" style={{ marginBottom: 4 }}>
            <span className="ctitle" style={{ margin: 0 }}>{boardScope} 프로젝트<span className="bscount">{boardProjects.length}</span></span>
            <button className="primary" onClick={openProj}>+ 프로젝트 추가</button>
          </div>
          <p className="chint">
            {isManager
              ? "단계별로 진행 상황과 참여자를 한눈에. "
              : <>우리 부서 인원이 참여하는 프로젝트가 바로 열립니다 — 타 부서가 등록한 협업 건도 <span className="cooptag inline">협업 · 부서명</span>으로 함께 표시돼요. <span className="minetag inline">참여중</span>은 내가 직접 참여한 프로젝트입니다. </>}
            프로젝트가 <b>완료</b> 단계에 들어가면 참여 팀원의 사용 기술이 자동으로 Lv↑ 됩니다.
          </p>
          {isManager && (
            <div className="boardfilter">
              <div className="sitetabs" role="tablist">
                {SITES.map((s) => {
                  const n = projects.filter((p) => projSiteOf(p) === s).length;
                  return (
                    <button key={s} role="tab" aria-selected={boardSite === s}
                      className={"sitetab" + (boardSite === s ? " on" : "")}
                      onClick={() => setBoardSite(s)}>
                      {s}<span className="sitecount">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="board">
            {STAGES.map((stage) => {
              const list = boardProjects.filter((p) => p.status === stage);
              return (
                <div className="bcol" key={stage}>
                  <div className="bcolhead">
                    <span className="bdot" style={{ background: STAGE_COLOR[stage] }} />
                    {stage}<span className="bcount">{list.length}</span>
                  </div>
                  {list.length === 0 && <div className="bempty">없음</div>}
                  {list.map((p) => (
                    <div className="pcard-slot" key={p.id}>
                    <div className={"pcard clickable" + (!isManager && myProjIds.has(p.id) ? " mine" : "")} onClick={() => setProjView(p.id)} title="클릭하면 상세 보기">
                      <span className="pbar" style={{ background: STAGE_COLOR[stage] }} />
                      <div className="pcardtop">
                        {/* 뱃지는 flex 래퍼로 묶는다 — 카드가 좁아 줄바꿈돼도 좌측 정렬이 흐트러지지 않게 */}
                        {!isManager && (myProjIds.has(p.id) || (projTeamOf(p) && !isMyOrg(projTeamOf(p)))) && (
                          <div className="pcardtags">
                            {myProjIds.has(p.id) && <span className="minetag">참여중</span>}
                            {/* 타 부서가 주관하는 협업 건 — 어느 부서 프로젝트인지 밝혀 우리 부서 건과 섞이지 않게 */}
                            {projTeamOf(p) && !isMyOrg(projTeamOf(p)) && (
                              <span className="cooptag" title={`${projTeamOf(p)} 주관 · 우리 부서와 협업`}>협업 · {projTeamOf(p)}</span>
                            )}
                          </div>
                        )}
                        <span className="pcardtitle">{p.title}</span>
                      </div>
                      {p.date && <span className="pdue">📅 {p.date}</span>}
                      {p.lead && <span className="plead">PM {p.lead}</span>}
                      <div className="pavatars">
                        {p.members.map((m) => (
                          <span className="avatar" key={m.id} style={{ background: nameColor(m.name) }} title={m.name}>{m.name.slice(-2)}</span>
                        ))}
                      </div>
                      {p.verified && (p.status === "완료" || p.status === "공유") && p.skills.length > 0 && (
                        <div className="pgrew">▲ {p.skills.map((s) => s.name).join(", ")} 성장반영</div>
                      )}
                      <select className="pmove" value={p.status} onClick={(e) => e.stopPropagation()} onChange={(e) => moveProject(p.id, e.target.value)}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
                    </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {activePage === "skills" && isManager && (
          <div className="filters">
            <input className="search" name="empSearch" placeholder="이름·스킬·강점 검색 (예: Vue, 협업)" value={q} onChange={(e) => setQ(e.target.value)} />
            {/* 네이티브 select 대신 커스텀 드롭다운 — 열림 방향·화살표를 브라우저·옵션수와 무관하게 통일 */}
            <Dropdown value={sortBy} onChange={setSortBy} className="compact"
              options={[{ value: "rank", label: "직급순" }, { value: "name", label: "이름순" }, { value: "team", label: "팀순" }]} />
            {/* 계단식 부서 필터. 본사는 대표부서(1단) → 팀(2단), 중부지사는 대표부서가 하나라 팀만.
                미선택 값 "전체"는 options에 넣지 않아 placeholder로만 보인다(되돌리기는 지사 탭 재클릭). */}
            {isMultiDiv && (
              <Dropdown value={skillDivSafe} placeholder="부서" sizeWith={allDivLabels}
                onChange={(v) => { setSkillDiv(v); setTeam("전체"); }}
                options={siteDivEntries.map(([d, teams]) => ({ value: d, label: `${d} (${divPeople(teams)})` }))} />
            )}
            {teamOptions.length > 0 && (
              <Dropdown value={teamSafe} placeholder="팀" className="wide"
                onChange={setTeam} sizeWith={allTeamsGlobal}
                options={teamOptions.map((t) => ({ value: t, label: t }))} />
            )}
          </div>
        )}
        {activePage === "skills" && isManager && (
        <div className="count-line">
          {/* 인원수는 선택한 지사·부서 기준 (탭·드롭다운과 일치) */}
          {`직원 ${filtered.length}명${hasFilter ? " (검색 결과)" : ""}`}
          <button className="primary" onClick={openNew}>+ 직원 추가</button>
        </div>
        )}

        {empListToShow.map((e) => {
          const isPrivate = e.visibility === "비공개" && e.id !== meId;
          const masked = isPrivate && !isManager; // 관리자는 비공개도 열람 가능, 일반 사용자에게만 마스킹
          return (
          <div className={"emp" + (masked ? " masked" : "")} key={e.id} onClick={() => !masked && setOpen(open === e.id ? null : e.id)}>
            <div className="ehead">
              <span className="ename">{e.name}</span>
              <span className="erank">{e.rank}</span>
              {masked
                ? <span className="lockbadge">🔒 비공개</span>
                : <><span className="esum">{e.skills.slice(0, 3).map((s) => s[0]).join(" · ")}{e.skills.length > 3 ? ` +${e.skills.length - 3}` : ""}</span>{isPrivate && <span className="lockbadge">🔒 비공개</span>}</>}
              <span className="eteam">{e.team}</span>
              {!masked && <span className="ecaret">{open === e.id ? "▲" : "▼"}</span>}
            </div>
            {masked ? (
              <div className="maskmsg">본인이 역량을 비공개로 설정했어요. AI 인력 매칭으로 추천될 때만 공개됩니다.</div>
            ) : (<>
            {open === e.id && (
              <div className="detail" onClick={(ev) => ev.stopPropagation()}>
                <div className="dsec"><h4>강점</h4><div className="strwrap">{e.strengths.map((s) => <span className="strchip" key={s}>{s}</span>)}</div></div>
                <div className="dsec">
                  <h4>보유 역량 · 숙련도</h4>
                  {e.skills.map((s) => {
                    const c = CAT_STYLE[s[2]] || { bg: "var(--hover)", fg: "#5B6B7F" };
                    return (
                    <div className="skrow" key={s[0]}>
                      <span className="nm">{s[0]}</span>
                      <span className="catbadge" style={{ background: c.bg, color: c.fg }}>{s[2]}</span>
                      <span className="barr"><span style={{ width: s[1] * 20 + "%", background: c.fg }} /></span>
                      <span className="lv">Lv.{s[1]}</span>
                      <span className="src">{s[3]}</span>
                    </div>
                    );
                  })}
                </div>
                {portfolioSec(e, canEdit(e))}

                <div className="dsec">
                  <h4>역량 개발 — 프로젝트·교육·자격증 이력과 오른 스킬을 한눈에</h4>
                  {(e.activities || []).length === 0 && !(canEdit(e) && actFor !== e.id) && <span className="aempty">아직 기록된 이력이 없어요.</span>}
                  <div className="actgridwrap">
                  {(e.activities || []).map((a, ai) => (
                    <div className="actrow clickable" key={ai} onClick={() => setActView({ activity: a, empName: e.name })} title="클릭하면 상세 보기">
                      <span className={"acttype t-" + a.type}>{ACT_ICON[a.type]} {a.type}</span>
                      <span className="acttitle">{a.title}</span>
                      {a.date && <span className="actdate">{a.date}</span>}
                      {(a.skills || []).length > 0 && <span className="actskcount">▲ {a.skills.length}</span>}
                    </div>
                  ))}
                  </div>

                  {canEdit(e) && (actFor === e.id ? (
                    <div className="actform">
                      <div className="actgrid">
                        <select value={actForm.type} onChange={(ev) => setActForm((f) => ({ ...f, type: ev.target.value }))}>
                          {ACT_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <input value={actForm.title} onChange={(ev) => setActForm((f) => ({ ...f, title: ev.target.value }))} placeholder="활동명 (예: 세움터 개편 프로젝트)" />
                        <input className="actdt" value={actForm.date} onChange={(ev) => setActForm((f) => ({ ...f, date: ev.target.value }))} placeholder="2025-06" />
                      </div>
                      <input className="actnew" value={actForm.desc} onChange={(ev) => setActForm((f) => ({ ...f, desc: ev.target.value }))} placeholder="간략한 설명 (선택, 예: 공공 포털 프론트엔드 구축)" />
                      <div className="actpicklbl">이 활동으로 성장한 스킬 선택 (Lv +1):</div>
                      <div className="strpick">
                        {e.skills.map((s) => <span key={s[0]} className={actForm.skills.includes(s[0]) ? "on" : ""} onClick={() => toggleActSkill(s[0])}>{s[0]}</span>)}
                      </div>
                      <input className="actnew" value={actForm.newSkill} onChange={(ev) => setActForm((f) => ({ ...f, newSkill: ev.target.value }))} placeholder="새로 생긴 스킬 추가 (선택, 예: Docker)" />
                      <div className="row">
                        <button className="primary" onClick={() => addActivity(e.id)}>활동 기록 · 스킬 반영</button>
                        <button className="ghost" onClick={() => setActFor(null)}>취소</button>
                      </div>
                    </div>
                  ) : (e.activities || []).length === 0 ? (
                    <div className="actempty">
                      <p>아직 기록된 이력이 없어요.<br />프로젝트·교육·자격증을 추가하면 관련 스킬이 자동으로 올라가요.</p>
                      <button className="primary" onClick={() => openAct(e.id)}>+ 역량 개발 기록</button>
                    </div>
                  ) : (
                    <button className="ghost actadd" onClick={() => openAct(e.id)}>+ 역량 개발 기록</button>
                  ))}
                </div>

                {e.id === meId ? (
                  // 본인만 자신의 공개 여부를 바꿀 수 있다
                  <div className="dsec">
                    <h4>역량 공개 설정</h4>
                    <div className="visline">
                      <div className="vistoggle">
                        <button className={e.visibility !== "비공개" ? "on" : ""} onClick={() => setVisibility(e.id, "공개")}>공개</button>
                        <button className={e.visibility === "비공개" ? "on" : ""} onClick={() => setVisibility(e.id, "비공개")}>비공개</button>
                      </div>
                      <span className="vishint">{e.visibility === "비공개" ? "비공개 — 다른 사람에겐 마스킹, AI 매칭 추천 때만 공개" : "공개 — 관리자·PM이 열람할 수 있어요"}</span>
                    </div>
                  </div>
                ) : isManager && (
                  // 관리자는 상태만 확인 (변경은 본인만)
                  <div className="dsec">
                    <h4>역량 공개 상태</h4>
                    <div className="visline">
                      <span className={"visstate" + (e.visibility === "비공개" ? " private" : "")}>
                        <Icon name={e.visibility === "비공개" ? "lock" : "unlock"} size={11} /> {e.visibility === "비공개" ? "비공개" : "공개"}
                      </span>
                      <span className="vishint">본인만 변경할 수 있어요</span>
                    </div>
                  </div>
                )}
                {canEdit(e) && <div className="row"><button onClick={() => openEdit(e)}>{e.id === meId && !isManager ? "내 역량 수정" : "수정"}</button></div>}
              </div>
            )}
            </>)}
          </div>
          );
        })}
        {activePage === "skills" && isManager && showList && visible.length === 0 && <div className="note">조건에 맞는 직원이 없어요. 검색어나 팀 필터를 바꿔보세요.</div>}
        {activePage === "skills" && isManager && showList && pageCount > 1 && (
          <div className="pager">
            <button className="ghost" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>이전</button>
            <span className="pageinfo">{pageSafe} / {pageCount} 페이지</span>
            <button className="ghost" disabled={pageSafe >= pageCount} onClick={() => setPage(pageSafe + 1)}>다음</button>
          </div>
        )}
          </div>
        </main>
      </div>
      )}

      {me && draft && (
        <div className="overlay" onClick={() => setDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{draft.id ? "직원 정보 수정" : "직원 추가"}</h2>
            <div className={"exbox" + (dragOver ? " drag" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={onDrop}>
              <label><Icon name="doc" size={14} /> 이력서/경력서 파일 또는 텍스트로 자동 채우기</label>
              <textarea value={exText} onChange={(e) => setExText(e.target.value)} placeholder="이력서 파일을 이 영역으로 끌어다 놓거나, 아래 버튼으로 첨부하세요. 경력 요약을 직접 붙여넣어도 됩니다." />
              <div className="filerow">
                <label className="filebtn">📎 파일 첨부 (PDF·이미지·TXT)
                  <input type="file" accept=".pdf,.txt,image/*" onChange={onFile} style={{ display: "none" }} />
                </label>
                <span className="droptip">또는 파일을 끌어다 놓기</span>
                {exFile && <span className="fname">{exFile.name}<button className="ghost xbtn" onClick={() => setExFile(null)}>✕</button></span>}
              </div>
              <div className="row">
                <button className="primary" onClick={extractFromText} disabled={exLoading}>
                  {exLoading ? <><span className="spin" />분석 중…</> : "AI로 자동 채우기"}
                </button>
                <span className="exhint">아래 칸이 자동으로 채워져요. 확인·보정 후 저장하세요.</span>
              </div>
              {dragOver && <div className="dropmsg">여기에 이력서 파일을 놓으세요</div>}
              {exNote && <div className="exnote">{exNote}</div>}
              {exErr && <div className="err">{exErr}</div>}
            </div>
            <div className="grid2">
              <div className="field"><label>이름</label><input value={draft.name} onChange={(e) => upd({ name: e.target.value })} placeholder="홍길동" /></div>
              <div className="field"><label>직급</label><input value={draft.rank} onChange={(e) => upd({ rank: e.target.value })} placeholder="선임" /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>이메일</label><input value={draft.email} onChange={(e) => upd({ email: e.target.value })} placeholder="(비우면 직원ID@solideo.co.kr)" /></div>
              <div className="field"><label>연락처</label><input value={draft.phone} onChange={(e) => upd({ phone: e.target.value })} placeholder="내선 1234 / 010-..." /></div>
            </div>
            <div className="field"><label>팀</label>
              <select value={draft.team} onChange={(e) => upd({ team: e.target.value })}>
                {(draft.team && !allocTeams.includes(draft.team) ? [draft.team, ...allocTeams] : allocTeams).map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            <div className="field">
              <label>보유 역량 (스킬명 · 분야 · 숙련도 · 출처)</label>
              {draft.skills.map((s, i) => (
                <div className="skedit" key={i}>
                  <input value={s[0]} onChange={(e) => setSkill(i, 0, e.target.value)} placeholder="Vue.js" />
                  <select value={s[2]} onChange={(e) => setSkill(i, 2, e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
                  <select value={s[1]} onChange={(e) => setSkill(i, 1, Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Lv.{n}</option>)}</select>
                  <select value={s[3]} onChange={(e) => setSkill(i, 3, e.target.value)}>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select>
                  <button className="ghost" onClick={() => rmSkill(i)}>✕</button>
                </div>
              ))}
              <button className="ghost" onClick={addSkill}>+ 스킬 추가</button>
            </div>

            <div className="field">
              <label>강점 (클릭해서 선택)</label>
              <div className="strpick">
                {STRENGTHS.map((s) => <span key={s} className={draft.strengths.includes(s) ? "on" : ""} onClick={() => toggleStr(s)}>{s}</span>)}
              </div>
            </div>
            <div className="field"><label>교육·자격 이력 (쉼표로 구분 · 역량 개발에 추가됨)</label><input value={draft.eduText} onChange={(e) => upd({ eduText: e.target.value })} placeholder="정보보안 기초, 웹접근성 실무" /></div>
            <div className="field"><label>프로젝트 이력 (쉼표로 구분 · 역량 개발에 추가됨)</label><input value={draft.projText} onChange={(e) => upd({ projText: e.target.value })} placeholder="세움터 개편, 공공 대시보드" /></div>

            <div className="modal-actions">
              {draft.id && isManager && <button className="danger" onClick={() => setConfirmDel({ kind: "emp", id: draft.id, title: draft.name })}>삭제</button>}
              <span className="spacer" />
              <button onClick={() => setDraft(null)}>취소</button>
              <button className="primary" onClick={saveDraft} disabled={!draft.name.trim()}>저장</button>
            </div>
          </div>
        </div>
      )}

      {me && projDraft && (
        <div className="overlay" onClick={() => setProjDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{projDraft.id ? "프로젝트 수정" : "프로젝트 추가"}</h2>
            <p className="chint">{projDraft.id
              ? "프로젝트 내용·팀원·단계를 수정합니다. 완료 단계로 처음 바꿀 때 참여 팀원의 스킬이 1단계 오릅니다."
              : "프로젝트장이 내용을 입력하고 팀원을 선정하면, 선정된 팀원에게 참여 이력이 남고 사용 기술의 숙련도가 자동으로 1단계 오릅니다."}</p>
            <div className="grid2">
              <div className="field"><label>프로젝트명</label><input value={projDraft.title} onChange={(e) => pUpd({ title: e.target.value })} placeholder="세움터 개편" /></div>
              <div className="field"><label>기간 / 시점</label><input value={projDraft.date} onChange={(e) => pUpd({ date: e.target.value })} placeholder="2025-06" /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>프로젝트장 (PM)</label><input value={projDraft.lead} onChange={(e) => pUpd({ lead: e.target.value })} placeholder="정유진" /></div>
              <div className="field"><label>단계</label>
                <select value={projDraft.status} onChange={(e) => pUpd({ status: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            <div className="field"><label>설명</label><input value={projDraft.desc} onChange={(e) => pUpd({ desc: e.target.value })} placeholder="공공 포털 프론트엔드 전면 개편" /></div>

            <div className="field">
              <label>사용 기술 (참여 팀원이 이 스킬로 성장합니다)</label>
              {projDraft.skills.map((s, i) => (
                <div className="pskedit" key={i}>
                  <input value={s[0]} onChange={(e) => pSetSkill(i, 0, e.target.value)} placeholder="Vue.js" />
                  <select value={s[1]} onChange={(e) => pSetSkill(i, 1, e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
                  <button className="ghost" onClick={() => pRmSkill(i)}>✕</button>
                </div>
              ))}
              <button className="ghost" onClick={pAddSkill}>+ 기술 추가</button>
            </div>

            <div className="field">
              <label>팀원 선정 ({projDraft.members.length}명 선택 — 본부·팀으로 좁혀서 클릭)</label>
              {projDraft.members.length > 0 && (
                <div className="pmselected">
                  {projDraft.members.map((id) => { const e = empById(id); return (
                    <span key={id} className="pmchip" onClick={() => pToggleMember(id)}>{e ? e.name : id} <b>✕</b></span>
                  ); })}
                </div>
              )}
              <div className="pmfilter">
                <select value={pmDiv} onChange={(e) => { setPmDiv(e.target.value); setPmTeam(""); }}>
                  <option value="">전체 본부·지사</option>
                  {divEntries.map(([d]) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={pmTeam} onChange={(e) => setPmTeam(e.target.value)}>
                  <option value="">{pmDiv ? "전체 팀" : "본부 먼저 선택"}</option>
                  {pmDiv && Object.keys(orgDivs[pmDiv] || {}).map((t) => <option key={t} value={t}>{t === pmDiv ? "본부 직속" : t}</option>)}
                </select>
                <input name="memberSearch" value={pmQuery} onChange={(e) => setPmQuery(e.target.value)} placeholder="이름 검색" />
              </div>
              {(() => {
                const q = pmQuery.trim().toLowerCase();
                const list = emps.filter((e) =>
                  (!pmDiv || divKeyOf(e) === pmDiv) &&
                  (!pmTeam || (pmTeam === pmDiv ? e.team === pmTeam : inTeam(pmTeam, e.team))) && // 산하 포함, "본부 직속"은 직속만
                  (!q || e.name.toLowerCase().includes(q))
                ).sort((a, b) => rankIdx(a.rank) - rankIdx(b.rank) || a.name.localeCompare(b.name, "ko")); // 직급순
                if (!pmDiv && !pmTeam && !q) return <div className="pmhint">👆 본부·지사를 선택하거나 이름을 검색해서 팀원을 고르세요. ({emps.length}명 전체)</div>;
                if (!list.length) return <div className="pmhint">조건에 맞는 직원이 없어요.</div>;
                return (
                  <div className="memberpick">
                    {list.slice(0, 80).map((e) => (
                      <span key={e.id} className={projDraft.members.includes(e.id) ? "on" : ""} onClick={() => pToggleMember(e.id)}>
                        {e.name} <small>{e.rank}</small>
                      </span>
                    ))}
                    {list.length > 80 && <span className="pmmore">+{list.length - 80}명 — 더 좁혀주세요</span>}
                  </div>
                );
              })()}
            </div>

            <div className="field">
              <button className="ghost evalbtn" onClick={evalComposition}>이 조합 평가하기</button>
              {evalResult && (evalResult.error
                ? <div className="evalerr">{evalResult.error}</div>
                : (
                  <div className="evalbox">
                    <div className="evalhead">
                      <span className={"evalscore " + (evalResult.score >= 80 ? "good" : evalResult.score >= 50 ? "mid" : "bad")}>기술 커버리지 {evalResult.score}%</span>
                      <span className="evalverdict">{evalResult.verdict}</span>
                    </div>
                    <div className="evalsub">요구 기술 커버리지 {evalResult.covered}/{evalResult.total} · 팀원 {evalResult.count}명</div>
                    <div className="evalcov">
                      {evalResult.coverage.map((c) => (
                        <div className="covrow" key={c.skill}>
                          <span className={"covskill " + (c.holders.length ? "ok" : "no")}>{c.holders.length ? "✅" : "❌"} {c.skill}</span>
                          <span className="covby">{c.holders.length ? c.holders.map((h) => `${h.name}(Lv${h.level})`).join(", ") : "보유자 없음"}</span>
                        </div>
                      ))}
                    </div>
                    {evalResult.gaps.length > 0 && <div className="evalwarn gap">⚠ 공백 역량: {evalResult.gaps.join(", ")} — 보강 필요</div>}
                    {evalResult.solo.length > 0 && <div className="evalwarn risk">⚠ 단일 의존(이탈 리스크): {evalResult.solo.map((s) => `${s.skill}(${s.who} 1명)`).join(", ")}</div>}
                    <div className="evalmeta">구성: {Object.entries(evalResult.ranks).map(([r, n]) => `${r} ${n}`).join(" · ")} · 강점: {evalResult.strengths.join(", ")}</div>
                  </div>
                ))}
            </div>

            <div className="modal-actions">
              <span className="spacer" />
              <button onClick={() => setProjDraft(null)}>취소</button>
              <button className="primary" onClick={saveProject} disabled={!projDraft.title.trim() || !projDraft.members.length}>{projDraft.id ? "수정 저장" : "프로젝트 생성 · 참여 기록"}</button>
            </div>
          </div>
        </div>
      )}

      {actView && (() => {
        const a = actView.activity;
        const proj = a.type === "프로젝트" ? projects.find((p) => p.title === a.title) : null;
        const desc = a.desc || proj?.desc || ACT_DESC[a.type];
        return (
          <div className="overlay confirmoverlay" onClick={() => setActView(null)}>
            <div className="projview" onClick={(ev) => ev.stopPropagation()}>
              <div className="pv-head">
                <span className={"acttype t-" + a.type}>{ACT_ICON[a.type]} {a.type}</span>
                <h3>{a.title}</h3>
              </div>
              <div className="pv-meta">
                {a.date && <span className="pdue">📅 {a.date}</span>}
                <span className="plead">{actView.empName}</span>
                {proj && <span className="pv-stage" style={{ background: STAGE_COLOR[proj.status] }}>{proj.status}</span>}
              </div>
              {desc && <p className="pv-desc">{desc}</p>}
              <div className="pv-sec">
                <h4>이 활동으로 오른 역량</h4>
                {(a.skills || []).length > 0
                  ? <div className="strwrap">{a.skills.map((s) => <span className="actsk" key={s}>{s} ▲</span>)}</div>
                  : <span className="aempty">기록된 스킬 변화가 없어요.</span>}
              </div>
              <div className="confirm-actions pv-actions">
                <button className="primary" onClick={() => setActView(null)}>닫기</button>
              </div>
            </div>
          </div>
        );
      })()}

      {projView && (() => {
        const p = projects.find((x) => x.id === projView);
        if (!p) return null;
        return (
          <div className="overlay confirmoverlay" onClick={() => setProjView(null)}>
            <div className="projview" onClick={(ev) => ev.stopPropagation()}>
              <div className="pv-head">
                <span className="pv-stage" style={{ background: STAGE_COLOR[p.status] }}>{p.status}</span>
                <h3>{p.title}</h3>
              </div>
              <div className="pv-meta">
                {p.date && <span className="pdue">📅 {p.date}</span>}
                {p.lead && <span className="plead">PM {p.lead}</span>}
              </div>
              {p.desc && <p className="pv-desc">{p.desc}</p>}
              {p.skills.length > 0 && (
                <div className="pv-sec"><h4>사용 기술</h4><div className="strwrap">{p.skills.map((s) => <span className="pill" key={s.name}>{s.name}</span>)}</div></div>
              )}
              <div className="pv-sec"><h4>참여 팀원 ({p.members.length}명)</h4>
                <div className="pv-members">
                  {p.members.map((m) => {
                    const e = empById(m.id);
                    const canGo = isManager && e; // 관리자만 역량 페이지 접근 가능
                    return (
                      <span className={"pv-member" + (canGo ? " go" : "")} key={m.id}
                        title={canGo ? "클릭하면 역량 보기" : undefined}
                        onClick={canGo ? () => { setProjView(null); goEmp(e); } : undefined}>
                        <span className="avatar" style={{ background: nameColor(m.name) }}>{m.name.slice(-2)}</span>{m.name}{e && <small>{e.rank}</small>}
                      </span>
                    );
                  })}
                </div>
              </div>
              {p.verified && (p.status === "완료" || p.status === "공유") && p.skills.length > 0 && <div className="pgrew">▲ {p.skills.map((s) => s.name).join(", ")} 성장반영 완료</div>}
              <div className="confirm-actions pv-actions">
                <button onClick={() => setProjView(null)}>닫기</button>
                {isManager && <button className="danger" onClick={() => { setProjView(null); setConfirmDel({ kind: "proj", id: p.id, title: p.title }); }}>삭제</button>}
                <button className="primary" onClick={() => { setProjView(null); openEditProj(p); }}>수정</button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmDel && (
        <div className="overlay confirmoverlay" onClick={() => setConfirmDel(null)}>
          <div className="confirmbox" onClick={(ev) => ev.stopPropagation()}>
            <div className="confirm-ico">{confirmDel.kind === "reset" ? "🔄" : "🗑"}</div>
            <h3>{confirmDel.kind === "proj" ? "프로젝트 삭제" : confirmDel.kind === "emp" ? "직원 삭제" : "데모 데이터 초기화"}</h3>
            {confirmDel.kind === "reset"
              ? <p>추가·수정한 모든 데이터를 지우고<br /><b>초기 시연 상태</b>로 되돌립니다.</p>
              : <p><b>{confirmDel.title}</b>{confirmDel.kind === "proj" ? " 프로젝트를 삭제할까요?" : " 님을 삭제할까요?"}<br /><span className="confirm-warn">이 작업은 되돌릴 수 없어요.</span></p>}
            <div className="confirm-actions">
              <button onClick={() => setConfirmDel(null)}>취소</button>
              <button className="danger solid" onClick={() => {
                if (confirmDel.kind === "proj") { deleteProject(confirmDel.id); notify("프로젝트를 삭제했어요", "warn"); }
                else if (confirmDel.kind === "emp") { deleteEmp(confirmDel.id); notify("직원을 삭제했어요", "warn"); }
                else { Object.keys(localStorage).filter((k) => k.startsWith("skillmap.")).forEach((k) => localStorage.removeItem(k)); location.reload(); return; }
                setConfirmDel(null);
              }}>{confirmDel.kind === "reset" ? "초기화" : "삭제"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={"toast " + toast.kind} key={toast.key}>{toast.msg}</div>}
    </div>
  );
}
