const STORAGE_KEY = 'sgpaCgpaPwaState';
const THEME_KEY = 'sgpaCgpaTheme';
const gradingSystems = {
  'standard-btech': {
    name: 'Standard B.Tech',
    grades: [
      { label: 'S', value: 10 },
      { label: 'A', value: 9 },
      { label: 'B', value: 8 },
      { label: 'C', value: 7 },
      { label: 'D', value: 6 },
      { label: 'E', value: 5 },
      { label: 'F', value: 0 }
    ]
  },
  vtu: {
    name: 'VTU 10-point',
    grades: [
      { label: 'S', value: 10 },
      { label: 'A', value: 9 },
      { label: 'B', value: 8 },
      { label: 'C', value: 7 },
      { label: 'D', value: 6 },
      { label: 'F', value: 0 }
    ]
  },
  'anna-university': {
    name: 'Anna University',
    grades: [
      { label: 'O', value: 10 },
      { label: 'A+', value: 9 },
      { label: 'A', value: 8 },
      { label: 'B+', value: 7 },
      { label: 'B', value: 6 },
      { label: 'C', value: 5 },
      { label: 'F', value: 0 }
    ]
  },
  jntu: {
    name: 'JNTU Pattern',
    grades: [
      { label: 'A+', value: 10 },
      { label: 'A', value: 9 },
      { label: 'B+', value: 8 },
      { label: 'B', value: 7 },
      { label: 'C', value: 6 },
      { label: 'D', value: 5 },
      { label: 'F', value: 0 }
    ]
  },
  'custom-7point': {
    name: 'Custom 7-point',
    grades: [
      { label: 'A', value: 7 },
      { label: 'B', value: 6 },
      { label: 'C', value: 5 },
      { label: 'D', value: 4 },
      { label: 'E', value: 3 },
      { label: 'F', value: 0 }
    ]
  }
};

const themeList = ['red-black', 'electric-blue', 'cyber-magenta', 'acid-green', 'violet-grid', 'orange-pulse'];
const DEFAULT_GRADING_SYSTEM = 'standard-btech';

function getCurrentGradeScale(systemId) {
  const active = systemId || (appState && appState.selectedGradingSystem) || DEFAULT_GRADING_SYSTEM;
  const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
  return grades.reduce((map, item) => {
    map[item.label] = item.value;
    return map;
  }, {});
}

function getGradeOptions(systemId) {
  const active = systemId || (appState && appState.selectedGradingSystem) || DEFAULT_GRADING_SYSTEM;
  const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
  return grades.map((grade) => `<option value="${grade.label}">${grade.label}</option>`).join('');
}

function getDefaultGradeLabel(systemId) {
  const active = systemId || (appState && appState.selectedGradingSystem) || DEFAULT_GRADING_SYSTEM;
  const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
  return grades[0]?.label || 'S';
}

const appElements = {
  semesterList: document.getElementById('semester-list'),
  semesterTabs: document.getElementById('semester-tabs'),
  addSemesterBtn: document.getElementById('top-add-semester-btn'),
  addSubjectBtn: document.getElementById('top-add-subject-btn'),
  deleteSemesterBtn: document.getElementById('top-delete-semester-btn'),
  resetAllBtn: document.getElementById('reset-all-btn'),
  exportBtn: document.getElementById('export-btn'),
  shareBtn: document.getElementById('share-btn'),
  installBtn: document.getElementById('install-btn'),
  themePicker: document.getElementById('theme-picker'),
  gradingSystemPicker: document.getElementById('grading-system-picker'),
  toastContainer: document.getElementById('toast-container'),
  summarySubjects: document.getElementById('summary-subjects'),
  summaryCurrentSgpa: document.getElementById('summary-current-sgpa'),
  summaryCredits: document.getElementById('summary-credits'),
  overallCgpa: document.getElementById('overall-cgpa'),
  summaryPercent: document.getElementById('summary-percent'),
  bestSgpa: document.getElementById('best-sgpa'),
  worstSgpa: document.getElementById('worst-sgpa'),
  avgSgpa: document.getElementById('avg-sgpa'),
  awardLabel: document.getElementById('award-label'),
  chartCanvas: document.getElementById('performance-chart')
};

let deferredPrompt = null;
let appState;
appState = loadState();
let performanceChart = null;

function createId() {
  return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function defaultSubject() {
  return { id: createId(), name: 'New Subject', credit: 3, grade: getDefaultGradeLabel() };
}

function defaultSemester(index = 1) {
  const fallbackGrade = getDefaultGradeLabel();
  return {
    id: createId(),
    title: `Semester ${index}`,
    subjects: [
      { id: createId(), name: 'Mathematics', credit: 4, grade: fallbackGrade },
      { id: createId(), name: 'Physics', credit: 3, grade: fallbackGrade },
      { id: createId(), name: 'Chemistry', credit: 3, grade: fallbackGrade },
      { id: createId(), name: 'Elective', credit: 2, grade: fallbackGrade }
    ]
  };
}

function buildInitialState() {
  const semesters = [defaultSemester(1)];
  return {
    theme: localStorage.getItem(THEME_KEY) || 'red-black',
    semesters,
    selectedSemesterId: semesters[0].id,
    selectedGradingSystem: localStorage.getItem('sgpaCgpaGradingSystem') || 'standard-btech'
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.semesters) && saved.semesters.length > 0) {
      const semesters = saved.semesters;
      const selectedSemesterId = semesters.some((semester) => semester.id === saved.selectedSemesterId)
        ? saved.selectedSemesterId
        : semesters[0].id;
      const savedSystem = saved.selectedGradingSystem || localStorage.getItem('sgpaCgpaGradingSystem') || 'standard-btech';
      const selectedGradingSystem = gradingSystems[savedSystem] ? savedSystem : 'standard-btech';
      return {
        theme: localStorage.getItem(THEME_KEY) || 'red-black',
        semesters,
        selectedSemesterId,
        selectedGradingSystem
      };
    }
  } catch (error) {
    console.warn('Could not parse saved state', error);
  }
  return buildInitialState();
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      semesters: appState.semesters,
      selectedSemesterId: appState.selectedSemesterId,
      selectedGradingSystem: appState.selectedGradingSystem
    })
  );
  localStorage.setItem('sgpaCgpaGradingSystem', appState.selectedGradingSystem);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (!themeList.includes(theme)) {
    theme = themeList[0];
  }
  root.dataset.theme = theme;
  if (appElements.themePicker) {
    appElements.themePicker.value = theme;
  }
  localStorage.setItem(THEME_KEY, theme);
  appState.theme = theme;
}

function applyGradingSystem(systemId) {
  if (!gradingSystems[systemId]) return;
  appState.selectedGradingSystem = systemId;
  if (appElements.gradingSystemPicker) {
    appElements.gradingSystemPicker.value = systemId;
  }
  appState.semesters.forEach((semester) => {
    semester.subjects.forEach((subject) => {
      if (!gradingSystems[systemId].grades.some((grade) => grade.label === subject.grade)) {
        subject.grade = getDefaultGradeLabel();
      }
    });
  });
  saveState();
  renderSemesters();
}

function getSemesterMetrics(semester) {
  const scale = getCurrentGradeScale();
  const metrics = semester.subjects.reduce(
    (acc, subject) => {
      const credit = Number(subject.credit) || 0;
      const points = credit * (scale[subject.grade] || 0);
      acc.totalCredits += credit;
      acc.totalPoints += points;
      return acc;
    },
    { totalCredits: 0, totalPoints: 0 }
  );

  const sgpa = metrics.totalCredits > 0 ? metrics.totalPoints / metrics.totalCredits : 0;
  const percent = sgpa * 9.5;
  return {
    ...metrics,
    sgpa,
    percent,
    gradePointAverage: metrics.totalCredits > 0 ? metrics.totalPoints / metrics.totalCredits : 0
  };
}

function getSelectedSemester() {
  return (
    appState.semesters.find((semester) => semester.id === appState.selectedSemesterId) ||
    appState.semesters[0]
  );
}

function getSelectedSemesterIndex() {
  return appState.semesters.findIndex((semester) => semester.id === appState.selectedSemesterId);
}

function setSelectedSemester(id) {
  if (appState.semesters.some((semester) => semester.id === id)) {
    appState.selectedSemesterId = id;
    saveState();
  }
}

function getSummaryStats() {
  const metrics = appState.semesters.map(getSemesterMetrics);
  const totalCredits = metrics.reduce((sum, item) => sum + item.totalCredits, 0);
  const totalSubjects = appState.semesters.reduce((sum, semester) => sum + semester.subjects.length, 0);
  const weightedPoints = metrics.reduce((sum, item) => sum + item.totalPoints, 0);
  const overallCgpa = totalCredits > 0 ? weightedPoints / totalCredits : 0;
  const sgpaValues = metrics.map((item) => (item.totalCredits > 0 ? item.sgpa : 0)).filter((value) => value > 0);
  const currentSgpa = metrics.length ? metrics[metrics.length - 1].sgpa : 0;

  return {
    totalCredits,
    totalSubjects,
    overallCgpa,
    overallPercent: overallCgpa * 9.5,
    currentSgpa,
    semesterCount: appState.semesters.length,
    bestSgpa: sgpaValues.length ? Math.max(...sgpaValues) : 0,
    worstSgpa: sgpaValues.length ? Math.min(...sgpaValues) : 0,
    averageSgpa: sgpaValues.length ? sgpaValues.reduce((sum, value) => sum + value, 0) / sgpaValues.length : 0
  };
}

function determineAward(cgpa) {
  if (cgpa >= 9) return 'Outstanding performance';
  if (cgpa >= 8) return 'Excellent trajectory';
  if (cgpa >= 7) return 'Strong progress';
  if (cgpa > 0) return 'Keep improving';
  return 'Start adding semester data';
}

function createSemesterCard(semester) {
  const card = document.createElement('section');
  card.className = 'semester-card';
  card.dataset.semesterId = semester.id;
  card.innerHTML = `
    <div class="semester-meta">
      <div>
        <h3>${semester.title}</h3>
        <small>${semester.subjects.length} subjects</small>
      </div>
    </div>
    <div class="subject-list"></div>
    <div class="semester-summary">
      <div class="metric-pill">
        <span>Total Credits</span>
        <strong class="semester-credit-value">0</strong>
      </div>
      <div class="metric-pill">
        <span>Total Points</span>
        <strong class="semester-point-value">0.00</strong>
      </div>
      <div class="metric-pill">
        <span>Semester SGPA</span>
        <strong class="semester-sgpa-value">0.00</strong>
      </div>
      <div class="metric-pill">
        <span>Estimated %</span>
        <strong class="semester-percent-value">0.00%</strong>
      </div>
    </div>
  `;

  const subjectList = card.querySelector('.subject-list');

  semester.subjects.forEach((subject) => {
    const row = document.createElement('div');
    row.className = 'subject-row';
    row.innerHTML = `
      <div class="subject-cell subject-name-cell">
        <label>Subject</label>
        <input class="subject-name" type="text" value="${subject.name}" />
      </div>
      <div class="subject-cell subject-meta-cell">
        <label>Grade</label>
        <select class="subject-grade">${getGradeOptions()}</select>
        <label>Credits</label>
        <input class="subject-credit" type="number" min="0" value="${subject.credit}" />
      </div>
      <button class="row-action" type="button" aria-label="Remove subject">Remove</button>
    `;

    const nameInput = row.querySelector('.subject-name');
    const gradeInput = row.querySelector('.subject-grade');
    const creditInput = row.querySelector('.subject-credit');
    const removeBtn = row.querySelector('.row-action');

    gradeInput.value = gradingSystems[appState.selectedGradingSystem]?.grades.some((grade) => grade.label === subject.grade)
      ? subject.grade
      : getDefaultGradeLabel();
    subject.grade = gradeInput.value;

    function updateSubject() {
      subject.name = nameInput.value;
      subject.credit = Number(creditInput.value) || 0;
      subject.grade = gradeInput.value;
      updateSemesterMetrics(semester, card);
      updateSummaryPanel();
      saveState();
    }

    nameInput.addEventListener('input', updateSubject);
    gradeInput.addEventListener('change', updateSubject);
    creditInput.addEventListener('input', updateSubject);

    removeBtn.addEventListener('click', () => {
      if (semester.subjects.length <= 1) {
        showToast('Each semester requires at least one subject.');
        return;
      }
      semester.subjects = semester.subjects.filter((item) => item.id !== subject.id);
      saveState();
      renderSemesters();
      showToast('Subject removed.');
    });

    subjectList.appendChild(row);
  });

  updateSemesterMetrics(semester, card);
  return card;
}

function updateSemesterMetrics(semester, card) {
  const metrics = getSemesterMetrics(semester);
  card.querySelector('.semester-credit-value').textContent = metrics.totalCredits;
  card.querySelector('.semester-point-value').textContent = metrics.totalPoints.toFixed(2);
  card.querySelector('.semester-sgpa-value').textContent = metrics.sgpa.toFixed(2);
  card.querySelector('.semester-percent-value').textContent = `${metrics.percent.toFixed(2)}%`;
}

function renderSemesterTabs() {
  appElements.semesterTabs.innerHTML = '';
  appState.semesters.forEach((semester, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `semester-tab${semester.id === appState.selectedSemesterId ? ' active' : ''}`;
    tab.textContent = `S${index + 1}`;
    tab.dataset.semesterId = semester.id;
    tab.addEventListener('click', () => {
      setSelectedSemester(semester.id);
      renderSemesters();
    });
    appElements.semesterTabs.appendChild(tab);
  });
}

function renderSemesters() {
  renderSemesterTabs();
  appElements.semesterList.innerHTML = '';
  const semester = getSelectedSemester();
  if (semester) {
    const card = createSemesterCard(semester);
    appElements.semesterList.appendChild(card);
  }
  updateSummaryPanel();
}

function updateSummaryPanel() {
  const summary = getSummaryStats();
  appElements.summarySubjects.textContent = summary.totalSubjects;
  appElements.summaryCurrentSgpa.textContent = summary.currentSgpa.toFixed(2);
  appElements.summaryCredits.textContent = summary.totalCredits;
  appElements.overallCgpa.textContent = summary.overallCgpa.toFixed(2);
  appElements.summaryPercent.textContent = `${summary.overallPercent.toFixed(2)}%`;
  appElements.bestSgpa.textContent = summary.bestSgpa.toFixed(2);
  appElements.worstSgpa.textContent = summary.worstSgpa.toFixed(2);
  appElements.avgSgpa.textContent = summary.averageSgpa.toFixed(2);
  appElements.awardLabel.textContent = determineAward(summary.overallCgpa);
  renderPerformanceChart();
}

function renderPerformanceChart() {
  const labels = appState.semesters.map((semester, index) => `S${index + 1}`);
  const values = appState.semesters.map((semester) => getSemesterMetrics(semester).sgpa.toFixed(2));

  if (!performanceChart) {
    performanceChart = new Chart(appElements.chartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'SGPA Trend',
          data: values,
          tension: 0.3,
          borderWidth: 3,
          borderColor: 'rgba(255,255,255,0.9)',
          backgroundColor: 'rgba(255, 59, 124, 0.22)',
          pointBackgroundColor: 'rgba(255,255,255,0.95)',
          pointBorderColor: 'rgba(255, 59, 124, 1)',
          pointRadius: 5,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20, 20, 30, 0.95)',
            titleColor: '#fff',
            bodyColor: '#f8f8ff',
            borderColor: 'rgba(255,255,255,0.16)',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.08)' },
            ticks: { color: '#d1d5db' }
          },
          y: {
            beginAtZero: true,
            max: 10,
            grid: { color: 'rgba(255,255,255,0.08)' },
            ticks: {
              color: '#d1d5db',
              stepSize: 2
            }
          }
        }
      }
    });
  } else {
    performanceChart.data.labels = labels;
    performanceChart.data.datasets[0].data = values;
    performanceChart.update();
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✔' : type === 'error' ? '✖' : type === 'warn' ? '⚠' : 'ℹ'}</span>
    <div class="toast-message">${message}</div>
  `;
  appElements.toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => toast.classList.remove('visible'), 4200);
  setTimeout(() => toast.remove(), 4600);
}

function resetAllData() {
  appState.semesters = [defaultSemester(1)];
  saveState();
  renderSemesters();
  showToast('All data cleared. Start a fresh academic plan.');
}

function copySummary() {
  const summary = getSummaryStats();
  const text = `Semesters: ${summary.semesterCount}\nCGPA: ${summary.overallCgpa.toFixed(2)}\nPercentage: ${summary.overallPercent.toFixed(2)}%\nCredits: ${summary.totalCredits}`;
  navigator.clipboard
    .writeText(text)
    .then(() => showToast('Summary copied to clipboard', 'success'))
    .catch(() => showToast('Unable to copy summary', 'error'));
}

function exportToPdf() {
  const report = document.createElement('div');
  report.className = 'pdf-report';
  const summary = getSummaryStats();
  const gradingName = gradingSystems[appState.selectedGradingSystem]?.name || 'Standard B.Tech';
  const semesterHtml = appState.semesters
    .map((semester, index) => {
      const semesterMetrics = getSemesterMetrics(semester);
      const rows = semester.subjects
        .map(
          (subject) => `
            <tr>
              <td>${subject.name}</td>
              <td>${subject.grade}</td>
              <td>${subject.credit}</td>
              <td>${getCurrentGradeScale()[subject.grade] || 0}</td>
            </tr>`
        )
        .join('');
      return `
        <section class="pdf-section">
          <h3>${semester.title}</h3>
          <p>${semester.subjects.length} subjects • SGPA ${semesterMetrics.sgpa.toFixed(2)} • ${semesterMetrics.percent.toFixed(2)}%</p>
          <table class="pdf-table">
            <thead>
              <tr><th>Subject</th><th>Grade</th><th>Credits</th><th>Value</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  report.innerHTML = `
    <div class="pdf-header">
      <h1>SGPA & CGPA Report</h1>
      <p>Grading system: ${gradingName}</p>
      <p>Date: ${new Date().toLocaleDateString()}</p>
      <div class="pdf-summary">
        <div><strong>Semesters</strong><span>${summary.semesterCount}</span></div>
        <div><strong>CGPA</strong><span>${summary.overallCgpa.toFixed(2)}</span></div>
        <div><strong>Percentage</strong><span>${summary.overallPercent.toFixed(2)}%</span></div>
        <div><strong>Total Credits</strong><span>${summary.totalCredits}</span></div>
      </div>
    </div>
    ${semesterHtml}
  `;

  document.body.appendChild(report);

  const opt = {
    margin: 10,
    filename: `SGPA-CGPA-Report-${new Date().toISOString().slice(0, 10)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf()
    .set(opt)
    .from(report)
    .save()
    .then(() => {
      showToast('PDF report generated successfully.', 'success');
      report.remove();
    })
    .catch(() => {
      showToast('Unable to generate PDF report.', 'error');
      report.remove();
    });
}

function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choice) => {
    if (choice.outcome === 'accepted') {
      showToast('App install prompt accepted.');
    } else {
      showToast('App install dismissed.');
    }
    deferredPrompt = null;
    appElements.installBtn.hidden = true;
  });
}

function deleteSelectedSemester() {
  const semester = getSelectedSemester();
  if (!semester) return;
  if (appState.semesters.length === 1) {
    showToast('At least one semester is required.');
    return;
  }
  if (confirm(`Delete ${semester.title} and all its subjects?`)) {
    appState.semesters = appState.semesters.filter((item) => item.id !== semester.id);
    appState.selectedSemesterId = appState.semesters[0]?.id || null;
    saveState();
    renderSemesters();
    showToast('Semester removed.');
  }
}

function setupEventListeners() {
  appElements.addSemesterBtn.addEventListener('click', () => {
    const newSemester = defaultSemester(appState.semesters.length + 1);
    appState.semesters.push(newSemester);
    appState.selectedSemesterId = newSemester.id;
    saveState();
    renderSemesters();
    showToast('Semester added.');
  });

  appElements.addSubjectBtn.addEventListener('click', () => {
    const semester = getSelectedSemester();
    semester.subjects.push(defaultSubject());
    saveState();
    renderSemesters();
    showToast('Subject added to current semester.');
  });

  appElements.deleteSemesterBtn.addEventListener('click', deleteSelectedSemester);

  appElements.resetAllBtn.addEventListener('click', () => {
    if (confirm('Reset all data and start over?')) {
      resetAllData();
    }
  });

  appElements.exportBtn.addEventListener('click', () => {
    exportToPdf();
  });

  appElements.shareBtn.addEventListener('click', copySummary);

  if (appElements.gradingSystemPicker) {
    appElements.gradingSystemPicker.addEventListener('change', () => {
      const selected = appElements.gradingSystemPicker.value;
      applyGradingSystem(selected);
      showToast(`Grading system set to ${gradingSystems[selected].name}.`, 'success');
    });
  }

  if (appElements.themePicker) {
    appElements.themePicker.addEventListener('change', () => {
      const nextTheme = appElements.themePicker.value;
      applyTheme(nextTheme);
      showToast(`Theme set to ${nextTheme.replace('-', ' ')}.`);
    });
  }

  appElements.installBtn.addEventListener('click', promptInstall);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    appElements.installBtn.hidden = false;
  });

  window.addEventListener('online', () => showToast('Back online'));
  window.addEventListener('offline', () => showToast('Offline mode enabled'));
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('sw.js')
      .then((registration) => {
        showToast('Offline caching is ready.');

        if (registration.waiting) {
          showToast('A new version is ready and will activate on the next reload.', 'info');
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('New app update available. Reload to activate it.', 'info');
            }
          });
        });
      })
      .catch(() => showToast('Service worker registration failed.'));
  }
}

function initializeApp() {
  applyTheme(appState.theme);
  setupEventListeners();
  renderSemesters();
  registerServiceWorker();
}

initializeApp();
