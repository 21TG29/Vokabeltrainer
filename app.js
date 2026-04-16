const SUPABASE_URL = 'https://mkagzmamqddzrojielop.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxX8YjEWydRur8H4bAqe1g_3dwaGE8g';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLES = {
  fr: 'vocabulary_lessons_fr',
  en: 'vocabulary_lessons_en'
};

let currentUser = null;
let currentLanguage = null;
let userProfile = null;
let selectedLessons = new Set();
let trainingData = [];
let trainingIndex = 0;
let trainingWrong = [];
let currentView = 'trainer';
let repeatMode = false;
let savedFirstAttempt = false;
const el = id => document.getElementById(id);

function calculateGrade(percent) { if (percent >= 92) return 1; if (percent >= 81) return 2; if (percent >= 67) return 3; if (percent >= 50) return 4; if (percent >= 30) return 5; return 6; }
function getGradeText(grade) { return {1:'Sehr gut',2:'Gut',3:'Befriedigend',4:'Ausreichend',5:'Mangelhaft',6:'Ungenügend'}[grade] || '-'; }
function getLanguageLabel(lang) { return lang === 'en' ? 'Englisch' : 'Französisch'; }
function getTableName(lang) { return TABLES[lang] || TABLES.fr; }

function setLanguage(lang) {
  currentLanguage = lang;
  if (el('languageModal')) el('languageModal').classList.add('hidden');
  el('currentLangLabel').textContent = getLanguageLabel(lang);
  renderLessons();
  updateLanguageInfo();
  loadStats();
  loadWeekStats();
  setView('trainer');
}

function setView(view) {
  currentView = view;
  el('trainerSection').classList.toggle('hidden', view !== 'trainer');
  el('statsSection').classList.toggle('hidden', view !== 'stats');
  el('navTrainer').classList.toggle('active', view === 'trainer');
  el('navStats').classList.toggle('active', view === 'stats');
  el('pageTitle').textContent = view === 'trainer' ? 'Trainer' : 'Statistik';
  el('pageSubtitle').textContent = view === 'trainer' ? 'Erstes Ergebnis speichert automatisch. Wiederholungen werden nicht gespeichert.' : 'Werte aus allen gespeicherten Erstversuchen.';
  if (view === 'stats') { loadWeekStats(); loadStats(); }
}

async function login() {
  try {
    const email = el('email').value.trim();
    const password = el('password').value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    el('loginView').classList.add('hidden');
    el('appView').classList.remove('hidden');
    el('loginError').classList.add('hidden');
    el('languageInfo').textContent = 'Lade Profil...';
    await loadProfile();
    if (userProfile?.can_learn_en && userProfile?.can_learn_fr) {
      el('languageModal').classList.remove('hidden');
      el('currentLangLabel').textContent = 'Sprache wählen';
    } else if (userProfile?.can_learn_en) {
      setLanguage('en');
    } else {
      setLanguage('fr');
    }
  } catch (e) {
    el('loginError').textContent = e?.message || 'Login fehlgeschlagen';
    el('loginError').classList.remove('hidden');
  }
}

async function loadProfile() {
  const { data } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
  userProfile = data || {};
  const parts = [];
  if (userProfile.can_learn_en) parts.push('Englisch aktiv');
  if (userProfile.can_learn_fr) parts.push('Französisch aktiv');
  el('languageInfo').textContent = parts.length ? parts.join(' · ') : 'Keine Sprache freigeschaltet.';
}

function getActiveLanguageRows() { return trainingData; }

async function loadLessons() {
  if (!currentUser || !currentLanguage) return [];
  const table = getTableName(currentLanguage);
  const { data, error } = await supabaseClient.from(table).select('*').order('lesson_group').order('lesson_name').order('sort_order');
  if (error) { el('lessonList').innerHTML = `<div class="error-box">Lerninhalte konnten nicht geladen werden: ${error.message}</div>`; return []; }
  return data || [];
}

async function renderLessons() {
  const container = el('lessonList');
  if (!currentLanguage) {
    container.innerHTML = '<div class="error-empty">Bitte zuerst eine Sprache wählen.</div>';
    return;
  }
  const rows = await loadLessons();
  const grouped = new Map();
  rows.forEach(r => {
    if (!grouped.has(r.lesson_group)) grouped.set(r.lesson_group, []);
    grouped.get(r.lesson_group).push(r);
  });
  container.innerHTML = '';
  Array.from(grouped.entries()).forEach(([groupName, groupRows]) => {
    const groupKey = `${currentLanguage}|${groupName}`;
    const groupSelected = groupRows.every(r => selectedLessons.has(String(r.id)));
    const groupBox = document.createElement('div');
    groupBox.className = 'group';
    groupBox.innerHTML = `<div class="group-head"><div class="group-left"><h5>${groupName}</h5><p>${groupRows.length} Vokabeln</p></div><button class="pill" type="button">${groupSelected ? 'Alles gewählt' : 'Alles wählen'}</button></div><div class="lessons">${groupRows.map(r => `<div class="lesson ${selectedLessons.has(String(r.id)) ? 'active' : ''}" data-id="${r.id}"><div><strong>${r.source_text}</strong><small>${r.target_text}</small></div><div class="check">+</div></div>`).join('')}</div>`;
    container.appendChild(groupBox);
    const pill = groupBox.querySelector('.pill');
    pill.onclick = () => {
      const allSelected = groupRows.every(r => selectedLessons.has(String(r.id)));
      groupRows.forEach(r => { if (allSelected) selectedLessons.delete(String(r.id)); else selectedLessons.add(String(r.id)); });
      renderLessons();
    };
    groupBox.querySelectorAll('.lesson').forEach(lesson => {
      lesson.onclick = () => {
        const id = lesson.dataset.id;
        if (selectedLessons.has(id)) selectedLessons.delete(id); else selectedLessons.add(id);
        renderLessons();
      };
    });
  });
  el('selectionInfo').textContent = `${selectedLessons.size} Vokabeln ausgewählt`;
}
async function startTraining() {
  if (!currentLanguage) return alert('Bitte zuerst eine Sprache wählen.');
  if (selectedLessons.size === 0) return alert('Wähle mindestens eine Vokabel!');
  const rows = await loadLessons();
  const selectedIds = new Set(Array.from(selectedLessons).map(String));
  trainingData = rows.filter(r => selectedIds.has(String(r.id))).sort(() => Math.random() - 0.5);
  if (!trainingData.length) { alert('Für die Auswahl konnten keine Vokabeln geladen werden.'); return; }
  trainingIndex = 0;
  trainingWrong = [];
  repeatMode = false;
  savedFirstAttempt = false;
  el('lessonList').style.display = 'none';
  el('startTrainingBtn').style.display = 'none';
  el('trainingArea').classList.remove('hidden');
  el('trainingResult').classList.add('hidden');
  showTrainingQuestion();
}

function showTrainingQuestion() {
  if (trainingIndex >= trainingData.length) return showTrainingResult();
  const vocab = trainingData[trainingIndex];
  el('trainingQuestion').textContent = vocab.source_text;
  el('trainingAnswer').value = '';
  el('trainingAnswer').focus();
  el('trainingProgress').style.width = `${(trainingIndex / trainingData.length) * 100}%`;
}

function checkAnswer() {
  const userInput = el('trainingAnswer').value.trim().toLowerCase();
  const correct = trainingData[trainingIndex].target_text.trim().toLowerCase();
  if (userInput !== correct) trainingWrong.push({ vocab: trainingData[trainingIndex], userInput });
  trainingIndex++;
  showTrainingQuestion();
}

async function showTrainingResult() {
  el('trainingArea').classList.add('hidden');
  el('trainingResult').classList.remove('hidden');
  const total = trainingData.length;
  const correct = total - trainingWrong.length;
  const wrong = trainingWrong.length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const grade = calculateGrade(percent);
  el('resultCorrect').textContent = correct;
  el('resultWrong').textContent = wrong;
  el('resultTotal').textContent = total;
  el('resultGrade').textContent = grade === '-' ? '-' : grade;
  el('resultGradeText').textContent = getGradeText(grade);
  const errorsContainer = el('resultErrors');
  if (trainingWrong.length === 0) { errorsContainer.innerHTML = '<div class="error-empty">🎉 Perfekt! Alle Vokabeln richtig!</div>'; el('repeatWrongBtn').classList.add('hidden'); }
  else { el('repeatWrongBtn').classList.remove('hidden'); errorsContainer.innerHTML = trainingWrong.map((entry, i) => `<div class="error-card"><div class="error-header"><span>Fehler #${i + 1}</span></div><div class="error-rows"><div class="error-row"><div><label>${getLanguageLabel(currentLanguage)}-Begriff</label><div>${entry.vocab.source_text}</div></div><div><label>Deine Eingabe</label><div class="error-your">${entry.userInput || 'Leer'}</div></div></div><div class="error-row" style="border-top:1px solid #fecaca;padding-top:12px;"><div style="grid-column:1 / -1;"><label>Richtige Lösung</label><div class="error-correct">${entry.vocab.target_text}</div></div></div></div></div>`).join(''); }
  await saveTrainingResult(total, correct, wrong, percent, grade);
}

async function loadStats() {
  if (!currentUser || !currentLanguage) return;
  const { data, error } = await supabaseClient.from('lesson_results').select('*').eq('user_id', currentUser.id).eq('language', currentLanguage).order('created_at', { ascending: false });
  if (error) { el('lessonStats').innerHTML = `<div class="error-box">Statistik konnte nicht geladen werden: ${error.message}</div>`; return; }
  const rows = data || [];
  const totalWords = rows.reduce((s, r) => s + Number(r.total_words || 0), 0);
  const correctWords = rows.reduce((s, r) => s + Number(r.correct_words || 0), 0);
  const wrongWords = rows.reduce((s, r) => s + Number(r.wrong_words || 0), 0);
  const percent = totalWords ? Math.round((correctWords / totalWords) * 100) : 0;
  const grade = rows.length ? calculateGrade(percent) : '-';
  el('statSessions').textContent = rows.length;
  el('statLearned').textContent = totalWords;
  el('statWrong').textContent = wrongWords;
  el('statCorrect').textContent = correctWords;
  el('statPercent').textContent = `${percent}%`;
  el('statGrade').textContent = grade === '-' ? '-' : `${grade}.0`;
  const grouped = new Map();
  rows.forEach(r => {
    const k = `${r.lesson_group}|${r.sublesson}`;
    if (!grouped.has(k)) grouped.set(k, { lesson_group: r.lesson_group, sublesson: r.sublesson, sessions: 0, total_words: 0, correct_words: 0, wrong_words: 0, gradeSum: 0 });
    const g = grouped.get(k);
    g.sessions += 1; g.total_words += Number(r.total_words || 0); g.correct_words += Number(r.correct_words || 0); g.wrong_words += Number(r.wrong_words || 0); g.gradeSum += Number(r.grade || 0);
  });
  const items = Array.from(grouped.values());
  el('lessonStats').innerHTML = items.length ? items.map(item => {
    const p = item.total_words ? Math.round((item.correct_words / item.total_words) * 100) : 0;
    const avg = item.sessions ? (item.gradeSum / item.sessions).toFixed(1) : '-';
    return `<div class="list-item"><div><h5>${item.lesson_group} · ${item.sublesson}</h5><p>${item.sessions} Sessions · ${item.total_words} Wörter</p></div><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;"><span class="chip ${currentLanguage === 'en' ? 'en' : 'fr'}">${getLanguageLabel(currentLanguage)}</span><span class="chip ok">${p}% richtig</span><span class="chip">Ø-Note ${avg}</span></div></div>`;
  }).join('') : '<div class="error-empty">Noch keine Trainingsdaten vorhanden.</div>';
}
async function loadWeekStats() {
  if (!currentUser || !currentLanguage) return;
  const { data, error } = await supabaseClient.from('lesson_results').select('*').eq('user_id', currentUser.id).eq('language', currentLanguage).order('created_at', { ascending: false });
  if (error) { el('weekLessonStats').innerHTML = `<div class="error-box">7-Tage-Statistik konnte nicht geladen werden: ${error.message}</div>`; return; }
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
  const rows = (data || []).filter(r => new Date(r.created_at) >= start);
  const totalWords = rows.reduce((s, r) => s + Number(r.total_words || 0), 0);
  const correctWords = rows.reduce((s, r) => s + Number(r.correct_words || 0), 0);
  const wrongWords = rows.reduce((s, r) => s + Number(r.wrong_words || 0), 0);
  const percent = totalWords ? Math.round((correctWords / totalWords) * 100) : 0;
  const grade = rows.length ? calculateGrade(percent) : '-';
  el('weekSessions').textContent = rows.length;
  el('weekLearned').textContent = totalWords;
  el('weekWrong').textContent = wrongWords;
  el('weekCorrect').textContent = correctWords;
  el('weekPercent').textContent = `${percent}%`;
  el('weekGrade').textContent = grade === '-' ? '-' : `${grade}.0`;
  const grouped = new Map();
  rows.forEach(r => {
    const k = `${r.lesson_group}|${r.sublesson}`;
    if (!grouped.has(k)) grouped.set(k, { lesson_group: r.lesson_group, sublesson: r.sublesson, sessions: 0, total_words: 0, correct_words: 0, wrong_words: 0, gradeSum: 0 });
    const g = grouped.get(k);
    g.sessions += 1; g.total_words += Number(r.total_words || 0); g.correct_words += Number(r.correct_words || 0); g.wrong_words += Number(r.wrong_words || 0); g.gradeSum += Number(r.grade || 0);
  });
  const items = Array.from(grouped.values());
  el('weekLessonStats').innerHTML = items.length ? items.map(item => {
    const p = item.total_words ? Math.round((item.correct_words / item.total_words) * 100) : 0;
    const avg = item.sessions ? (item.gradeSum / item.sessions).toFixed(1) : '-';
    return `<div class="list-item"><div><h5>${item.lesson_group} · ${item.sublesson}</h5><p>${item.sessions} Sessions · ${item.total_words} Wörter</p></div><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;"><span class="chip ${currentLanguage === 'en' ? 'en' : 'fr'}">${getLanguageLabel(currentLanguage)}</span><span class="chip ok">${p}% richtig</span><span class="chip">Ø-Note ${avg}</span></div></div>`;
  }).join('') : '<div class="error-empty">Noch keine Trainingsdaten in den letzten 7 Tagen.</div>';
}
async function saveTrainingResult(total, correct, wrong, percent, grade) {
  if (!currentUser || !currentLanguage || savedFirstAttempt) return;
  const grouped = new Map();
  trainingData.forEach(r => {
    const k = `${r.lesson_group}|${r.lesson_name}`;
    if (!grouped.has(k)) grouped.set(k, { lesson_group: r.lesson_group, lesson_name: r.lesson_name, count: 0 });
    grouped.get(k).count += 1;
  });
  const top = trainingData[0] || {};
  const payload = {
    user_id: currentUser.id,
    language: currentLanguage,
    lesson_group: top.lesson_group || 'Unbekannt',
    sublesson: top.lesson_name || 'Unbekannt',
    total_words: total,
    correct_words: correct,
    wrong_words: wrong,
    percent_score: percent,
    grade: grade,
    created_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from('lesson_results').insert([payload]);
  if (!error) {
    savedFirstAttempt = true;
    loadStats();
    loadWeekStats();
  }
}
function updateLanguageInfo() { el('languageInfo').textContent = `${getLanguageLabel(currentLanguage)} ausgewählt`; }
function updateLanguageInfo() { el('languageInfo').textContent = `${getLanguageLabel(currentLanguage)} ausgewählt`; }
function updateLanguageInfo() { el('languageInfo').textContent = `${getLanguageLabel(currentLanguage)} ausgewählt`; }
function updateTrainerSummary() { return; }

window.handleLogout = async function() {
  try { await supabaseClient.auth.signOut(); } catch (_) {}
  currentUser = null;
  userProfile = null;
  currentLanguage = null;
  selectedLessons.clear();
  trainingData = [];
  trainingIndex = 0;
  trainingWrong = [];
  repeatMode = false;
  savedFirstAttempt = false;
  el('appView').classList.add('hidden');
  el('loginView').classList.remove('hidden');
  el('loginError').classList.add('hidden');
  el('password').value = '';
  el('email').value = '';
  el('languageModal').classList.add('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
  el('loginBtn').addEventListener('click', (e) => { e.preventDefault(); login(); });
  el('password').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });
  el('email').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });
  el('navTrainer').onclick = () => setView('trainer');
  el('navStats').onclick = () => setView('stats');
  el('refreshBtn').onclick = () => currentView === 'stats' ? loadStats() : renderLessons();
  el('startTrainingBtn').onclick = startTraining;
  el('checkAnswerBtn').onclick = checkAnswer;
  el('skipBtn').onclick = () => { trainingIndex++; showTrainingQuestion(); };
  el('trainingAnswer').onkeydown = e => { if (e.key === 'Enter') checkAnswer(); };
  el('repeatWrongBtn').onclick = () => { if (trainingWrong.length === 0) return; repeatMode = true; trainingData = trainingWrong.map(x => x.vocab).sort(() => Math.random() - 0.5); trainingIndex = 0; trainingWrong = []; el('trainingResult').classList.add('hidden'); el('trainingArea').classList.remove('hidden'); showTrainingQuestion(); };
  el('newTrainingBtn').onclick = () => { selectedLessons.clear(); renderLessons(); el('lessonList').style.display = 'block'; el('startTrainingBtn').style.display = 'block'; el('trainingResult').classList.add('hidden'); el('trainingArea').classList.add('hidden'); el('selectionInfo').textContent = '0 Vokabeln ausgewählt'; trainingData = []; trainingIndex = 0; trainingWrong = []; repeatMode = false; savedFirstAttempt = false; };
  el('logoutBtn').onclick = function(e) { if (e) e.preventDefault(); window.handleLogout(); };
  el('langFrBtn').onclick = () => setLanguage('fr');
  el('langEnBtn').onclick = () => setLanguage('en');
});
