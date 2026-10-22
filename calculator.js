(function (root) {
  'use strict';

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
        { label: 'E', value: 5 },
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

  const DEFAULT_GRADING_SYSTEM = 'standard-btech';

  function getCurrentGradeScale(systemId) {
    const active = systemId || DEFAULT_GRADING_SYSTEM;
    const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
    return grades.reduce((map, item) => {
      map[item.label] = item.value;
      return map;
    }, {});
  }

  function getDefaultGradeLabel(systemId) {
    const active = systemId || DEFAULT_GRADING_SYSTEM;
    const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
    return grades[0]?.label || 'S';
  }

  function parseCredit(raw) {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text === '') return { valid: false, value: null };
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return { valid: false, value: null };
    return { valid: true, value };
  }

  function getInvalidCreditCount(semesters) {
    return semesters.reduce(
      (count, semester) => count + semester.subjects.filter((subject) => !parseCredit(subject.credit).valid).length,
      0
    );
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toDomIdToken(value) {
    const text = value === null || value === undefined ? '' : String(value);
    let token;

    try {
      token = encodeURIComponent(text);
    } catch {
      token = '';
    }

    return token || 'item';
  }

  function createSubjectControlIds(semesterId, subjectId, usedIds) {
    const base = `subject-${toDomIdToken(semesterId)}-${toDomIdToken(subjectId)}`;
    const ids = {
      name: `${base}-name`,
      grade: `${base}-grade`,
      credit: `${base}-credit`,
      gradeError: `${base}-grade-error`,
      creditError: `${base}-credit-error`
    };

    if (!usedIds || typeof usedIds.has !== 'function' || typeof usedIds.add !== 'function') {
      return ids;
    }

    const uniqueIds = {};

    Object.keys(ids).forEach((key) => {
      const candidate = ids[key];
      let unique = candidate;
      let suffix = 2;

      while (usedIds.has(unique)) {
        unique = `${candidate}-${suffix}`;
        suffix += 1;
      }

      usedIds.add(unique);
      uniqueIds[key] = unique;
    });

    return uniqueIds;
  }

  function computeSemesterMetrics(subjects, systemId) {
    const scale = getCurrentGradeScale(systemId);
    const metrics = subjects.reduce(
      (acc, subject) => {
        const creditInfo = parseCredit(subject.credit);
        if (!creditInfo.valid) return acc;
        const credit = creditInfo.value;
        // Only an own property of the scale counts as a grade. A label such as
        // "constructor" or "toString" must never resolve to an inherited
        // object member, which would poison every total with NaN.
        const gradeValue = Object.prototype.hasOwnProperty.call(scale, subject.grade) ? scale[subject.grade] : 0;
        const points = credit * gradeValue;
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

  function computeSummary(semesters, systemId) {
    const metrics = semesters.map((semester) => computeSemesterMetrics(semester.subjects, systemId));
    const totalCredits = metrics.reduce((sum, item) => sum + item.totalCredits, 0);
    const totalSubjects = semesters.reduce((sum, semester) => sum + semester.subjects.length, 0);
    const weightedPoints = metrics.reduce((sum, item) => sum + item.totalPoints, 0);
    const overallCgpa = totalCredits > 0 ? weightedPoints / totalCredits : 0;
    const sgpaValues = metrics.filter((item) => item.totalCredits > 0).map((item) => item.sgpa);
    const currentSgpa = metrics.length ? metrics[metrics.length - 1].sgpa : 0;

    return {
      totalCredits,
      totalSubjects,
      overallCgpa,
      overallPercent: overallCgpa * 9.5,
      currentSgpa,
      semesterCount: semesters.length,
      bestSgpa: sgpaValues.length ? Math.max(...sgpaValues) : 0,
      worstSgpa: sgpaValues.length ? Math.min(...sgpaValues) : 0,
      averageSgpa: sgpaValues.length ? sgpaValues.reduce((sum, value) => sum + value, 0) / sgpaValues.length : 0
    };
  }

  function determineAward(cgpa, context) {
    const options = context || {};
    const hasSemesterData = Boolean(options.hasSemesterData);
    const incomplete = Boolean(options.incomplete);

    if (cgpa >= 9) return 'Outstanding performance';
    if (cgpa >= 8) return 'Excellent trajectory';
    if (cgpa >= 7) return 'Strong progress';
    if (cgpa > 0) return 'Keep improving';
    if (!hasSemesterData) return 'Start adding semester data';
    if (incomplete) return 'Results incomplete — review flagged subjects';
    return 'No points earned yet — review your subjects';
  }

  /**
   * Legacy helper kept for compatibility. It never mutates the subjects it is
   * given: a caller that ignores the return value can no longer have its
   * grades rewritten. The user interface does not use it, because a grading
   * system change is planned and confirmed instead of applied silently.
   */
  function remapGradesForSystem(subjects, systemId) {
    if (!Array.isArray(subjects)) return subjects;
    if (!gradingSystems[systemId]) return subjects.slice();
    const validLabels = gradingSystems[systemId].grades;
    return subjects.map((subject) => {
      if (!subject || typeof subject !== 'object') return subject;
      if (validLabels.some((grade) => grade.label === subject.grade)) return subject;
      return { ...subject, grade: getDefaultGradeLabel(systemId) };
    });
  }

  function isGradeSupported(grade, systemId) {
    const active = gradingSystems[systemId] ? systemId : DEFAULT_GRADING_SYSTEM;
    return Object.prototype.hasOwnProperty.call(getCurrentGradeScale(active), grade);
  }

  function getUnsupportedGrades(semesters, systemId) {
    const active = gradingSystems[systemId] ? systemId : DEFAULT_GRADING_SYSTEM;
    const unsupported = [];
    semesters.forEach((semester) => {
      semester.subjects.forEach((subject) => {
        if (!isGradeSupported(subject.grade, active)) {
          unsupported.push({
            semesterId: semester.id,
            subjectId: subject.id,
            name: subject.name,
            grade: subject.grade
          });
        }
      });
    });
    return unsupported;
  }

  function getIncompleteReport(semesters, systemId) {
    const invalidCreditCount = getInvalidCreditCount(semesters);
    const unsupportedGradeCount = getUnsupportedGrades(semesters, systemId).length;
    return {
      invalidCreditCount,
      unsupportedGradeCount,
      incomplete: invalidCreditCount > 0 || unsupportedGradeCount > 0
    };
  }

  function sanitizeSavedState(saved, options) {
    const config = options || {};
    const createId =
      typeof config.createId === 'function'
        ? config.createId
        : () => `id-${Math.random().toString(36).slice(2)}`;
    const savedSystem =
      saved && typeof saved === 'object' && saved.selectedGradingSystem ? saved.selectedGradingSystem : '';
    const legacySystem = typeof config.fallbackSystem === 'string' ? config.fallbackSystem : '';
    const systemCandidate = savedSystem || legacySystem;
    const selectedGradingSystem = gradingSystems[systemCandidate] ? systemCandidate : DEFAULT_GRADING_SYSTEM;

    let repaired = false;

    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.semesters)) {
      return { unrecoverable: true, repaired: true, semesters: [], selectedSemesterId: null, selectedGradingSystem };
    }

    const usedSemesterIds = new Set();
    const usedSubjectIds = new Set();
    const semesters = [];

    function uniqueId(candidate, usedIds) {
      if (typeof candidate === 'string' && candidate.trim() !== '' && !usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }

      let generated = createId();
      while (typeof generated !== 'string' || generated === '' || usedIds.has(generated)) {
        generated = createId();
      }
      usedIds.add(generated);
      repaired = true;
      return generated;
    }

    saved.semesters.forEach((rawSemester) => {
      if (!rawSemester || typeof rawSemester !== 'object' || Array.isArray(rawSemester)) {
        repaired = true;
        return;
      }

      const id = uniqueId(rawSemester.id, usedSemesterIds);
      let title = rawSemester.title;

      if (typeof title !== 'string' || title.trim() === '') {
        title = `Semester ${semesters.length + 1}`;
        repaired = true;
      }

      const rawSubjects = Array.isArray(rawSemester.subjects) ? rawSemester.subjects : [];

      if (!Array.isArray(rawSemester.subjects)) {
        repaired = true;
      }

      const subjects = [];

      rawSubjects.forEach((rawSubject) => {
        if (!rawSubject || typeof rawSubject !== 'object' || Array.isArray(rawSubject)) {
          repaired = true;
          return;
        }

        const subjectId = uniqueId(rawSubject.id, usedSubjectIds);
        let name = rawSubject.name;
        let grade = rawSubject.grade;
        let credit = rawSubject.credit;

        if (typeof name !== 'string') {
          name = '';
          repaired = true;
        }

        if (typeof grade !== 'string') {
          grade = '';
          repaired = true;
        }

        if (typeof credit !== 'string' && typeof credit !== 'number') {
          credit = '';
          repaired = true;
        }

        subjects.push({ id: subjectId, name, grade, credit });
      });

      semesters.push({ id, title, subjects });
    });

    if (semesters.length === 0) {
      return { unrecoverable: true, repaired: true, semesters: [], selectedSemesterId: null, selectedGradingSystem };
    }

    const selectedSemesterId = semesters.some((semester) => semester.id === saved.selectedSemesterId)
      ? saved.selectedSemesterId
      : semesters[0].id;

    if (selectedSemesterId !== saved.selectedSemesterId) {
      repaired = true;
    }

    return { unrecoverable: false, repaired, semesters, selectedSemesterId, selectedGradingSystem };
  }

  /* ------------------------------------------------------------- backups */

  const BACKUP_FORMAT = 'sgpa-cgpa-backup';
  const BACKUP_VERSION = 1;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  /**
   * Builds a backup document from a saved plan. The plan keeps the exact shape
   * that is stored on the device, so a backup can be restored without any
   * conversion. Nothing else is included: no tokens, no passwords, no other
   * browser data.
   */
  function createBackup(plan, meta) {
    const source = isPlainObject(plan) ? plan : {};
    const semesters = Array.isArray(source.semesters) ? source.semesters : [];
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: (isPlainObject(meta) && isNonEmptyString(meta.exportedAt) ? meta.exportedAt : new Date().toISOString()),
      plan: {
        semesters: JSON.parse(JSON.stringify(semesters)),
        selectedSemesterId: isNonEmptyString(source.selectedSemesterId) ? source.selectedSemesterId : null,
        selectedGradingSystem: isNonEmptyString(source.selectedGradingSystem) ? source.selectedGradingSystem : DEFAULT_GRADING_SYSTEM
      }
    };
  }

  /**
   * Parses and validates a backup document.
   * @returns {{ok: true, backup: object} | {ok: false, error: {code: string, message: string}}}
   */
  function parseBackup(text) {
    if (typeof text !== 'string' || text.trim() === '') {
      return { ok: false, error: { code: 'empty', message: 'The selected file is empty.' } };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: { code: 'malformed', message: 'The selected file is not valid JSON.' } };
    }

    if (!isPlainObject(parsed)) {
      return { ok: false, error: { code: 'schema', message: 'The selected file does not contain a backup.' } };
    }

    if (parsed.format !== BACKUP_FORMAT) {
      return { ok: false, error: { code: 'format', message: 'The selected file is not an SGPA & CGPA backup.' } };
    }

    if (parsed.version !== BACKUP_VERSION) {
      return {
        ok: false,
        error: {
          code: 'version',
          message: `This backup uses format version ${String(parsed.version)}, which this version of the app cannot read.`
        }
      };
    }

    const plan = parsed.plan;
    if (!isPlainObject(plan) || !Array.isArray(plan.semesters)) {
      return { ok: false, error: { code: 'schema', message: 'The backup does not contain a semester plan.' } };
    }

    if (plan.semesters.length === 0) {
      return { ok: false, error: { code: 'empty-plan', message: 'The backup does not contain any semesters.' } };
    }

    for (let index = 0; index < plan.semesters.length; index += 1) {
      const semester = plan.semesters[index];
      if (!isPlainObject(semester)) {
        return { ok: false, error: { code: 'schema', message: `Semester ${index + 1} in the backup is not valid.` } };
      }
      if (!isNonEmptyString(semester.id)) {
        return { ok: false, error: { code: 'schema', message: `Semester ${index + 1} in the backup has no identifier.` } };
      }
      if (typeof semester.title !== 'string') {
        return { ok: false, error: { code: 'schema', message: `Semester ${index + 1} in the backup has an invalid title.` } };
      }
      if (!Array.isArray(semester.subjects)) {
        return { ok: false, error: { code: 'schema', message: `Semester ${index + 1} in the backup has an invalid subject list.` } };
      }
      for (let subjectIndex = 0; subjectIndex < semester.subjects.length; subjectIndex += 1) {
        const subject = semester.subjects[subjectIndex];
        if (!isPlainObject(subject)) {
          return { ok: false, error: { code: 'schema', message: `A subject in semester ${index + 1} of the backup is not valid.` } };
        }
        if (!isNonEmptyString(subject.id)) {
          return { ok: false, error: { code: 'schema', message: `A subject in semester ${index + 1} of the backup has no identifier.` } };
        }
        if (typeof subject.name !== 'string') {
          return { ok: false, error: { code: 'schema', message: `A subject in semester ${index + 1} of the backup has an invalid name.` } };
        }
        if (typeof subject.grade !== 'string') {
          return { ok: false, error: { code: 'schema', message: `A subject in semester ${index + 1} of the backup has an invalid grade.` } };
        }
        const credit = subject.credit;
        const creditIsValid = typeof credit === 'string' || (typeof credit === 'number' && Number.isFinite(credit));
        if (!creditIsValid) {
          return { ok: false, error: { code: 'schema', message: `A subject in semester ${index + 1} of the backup has an invalid credit value.` } };
        }
      }
    }

    if (plan.selectedSemesterId !== null && plan.selectedSemesterId !== undefined && !isNonEmptyString(plan.selectedSemesterId)) {
      return { ok: false, error: { code: 'schema', message: 'The backup has an invalid selected semester.' } };
    }

    if (!isNonEmptyString(plan.selectedGradingSystem) || !gradingSystems[plan.selectedGradingSystem]) {
      return {
        ok: false,
        error: { code: 'schema', message: 'The backup uses a grading system this version of the app does not know.' }
      };
    }

    return { ok: true, backup: parsed };
  }

  /** A short, human readable summary used to preview a backup before restoring it. */
  function summarizeBackup(backup) {
    const plan = isPlainObject(backup) && isPlainObject(backup.plan) ? backup.plan : null;
    const semesters = plan && Array.isArray(plan.semesters) ? plan.semesters : [];
    const subjects = semesters.reduce((total, semester) => {
      const list = isPlainObject(semester) && Array.isArray(semester.subjects) ? semester.subjects : [];
      return total + list.length;
    }, 0);
    const systemId = plan && isNonEmptyString(plan.selectedGradingSystem) ? plan.selectedGradingSystem : DEFAULT_GRADING_SYSTEM;

    return {
      semesters: semesters.length,
      subjects,
      gradingSystem: systemId,
      gradingSystemName: gradingSystems[systemId] ? gradingSystems[systemId].name : systemId,
      exportedAt: isPlainObject(backup) && isNonEmptyString(backup.exportedAt) ? backup.exportedAt : null
    };
  }

  // Pure, non-mutating. Reports grades absent from the destination system and
  // grades whose point value differs between the source and destination systems.
  // Never proposes or applies a replacement label.
  function planGradingSystemChange(subjects, toSystemId, fromSystemId) {
    const from = fromSystemId || DEFAULT_GRADING_SYSTEM;
    if (!gradingSystems[toSystemId]) {
      return {
        known: false,
        fromSystemId: from,
        toSystemId,
        requiresConfirmation: false,
        unknown: [],
        valueChanges: []
      };
    }

    const fromScale = getCurrentGradeScale(from);
    const toScale = getCurrentGradeScale(toSystemId);
    const unknown = [];
    const valueChanges = [];

    subjects.forEach((subject) => {
      const label = subject.grade;
      const supported = Object.prototype.hasOwnProperty.call(toScale, label);

      if (!supported) {
        unknown.push({
          id: subject.id,
          name: subject.name,
          label,
          fromValue: Object.prototype.hasOwnProperty.call(fromScale, label) ? fromScale[label] : null,
          toValue: null
        });
        return;
      }

      const fromValue = Object.prototype.hasOwnProperty.call(fromScale, label) ? fromScale[label] : null;
      const toValue = toScale[label];

      if (fromValue !== toValue) {
        valueChanges.push({ id: subject.id, name: subject.name, label, fromValue, toValue });
      }
    });

    return {
      known: true,
      fromSystemId: from,
      toSystemId,
      requiresConfirmation: unknown.length > 0 || valueChanges.length > 0,
      unknown,
      valueChanges
    };
  }

  const api = {
    gradingSystems,
    DEFAULT_GRADING_SYSTEM,
    getCurrentGradeScale,
    getDefaultGradeLabel,
    parseCredit,
    getInvalidCreditCount,
    escapeHtml,
    createSubjectControlIds,
    computeSemesterMetrics,
    computeSummary,
    determineAward,
    remapGradesForSystem,
    isGradeSupported,
    getUnsupportedGrades,
    getIncompleteReport,
    sanitizeSavedState,
    planGradingSystemChange,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    createBackup,
    parseBackup,
    summarizeBackup
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SgpaCalculator = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
