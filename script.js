const STORAGE_KEY = 'sgpaCgpaPwaState';
const THEME_KEY = 'sgpaCgpaTheme';
/**
 * Holds the last payload that could not be read. The main key keeps its
 * existing format; this sibling key only ever receives a verbatim copy of
 * data that was about to be replaced, so nothing is lost silently.
 */
const RECOVERY_KEY = 'sgpaCgpaPwaStateRecovery';

const { gradingSystems, DEFAULT_GRADING_SYSTEM, escapeHtml } = SgpaCalculator;
const DEFAULT_THEME = 'premium-navy';
const themeList = ['light', 'red-black', 'electric-blue', 'cyber-magenta', 'acid-green', 'violet-grid', 'orange-pulse', 'premium-navy'];

/** The notification stack never shows more than this many toasts at once. */
const MAX_VISIBLE_TOASTS = 3;

function getCurrentGradeScale(systemId) {
  return SgpaCalculator.getCurrentGradeScale(systemId || (appState && appState.selectedGradingSystem));
}

function getGradeOptions(systemId) {
  const active = systemId || (appState && appState.selectedGradingSystem) || DEFAULT_GRADING_SYSTEM;
  const grades = gradingSystems[active]?.grades || gradingSystems[DEFAULT_GRADING_SYSTEM].grades;
  return grades.map((grade) => `<option value="${grade.label}">${grade.label}</option>`).join('');
}

function getDefaultGradeLabel(systemId) {
  return SgpaCalculator.getDefaultGradeLabel(systemId || (appState && appState.selectedGradingSystem));
}

function subjectControlLabel(label, subject) {
  const name = subject && subject.name ? String(subject.name).trim() : '';
  return name ? `${label} for ${name}` : label;
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
  trendChart: document.getElementById('trend-chart'),
  trendTableBody: document.getElementById('trend-table-body')
};

let deferredPrompt = null;
let stateRecoveryNotice = null;
let storageWarningShown = false;
let appState;

/* ============================================================
   Confirmation dialog
   A reusable, accessible replacement for window.confirm().
   The dialog is a single reusable element: it traps Tab inside
   itself, closes on Escape, and returns focus to the control that
   opened it.
   ============================================================ */

const DIALOG_TITLE_ID = 'sgpa-dialog-title';
const DIALOG_DESCRIPTION_ID = 'sgpa-dialog-description';

function createConfirmDialog() {
  let decisionHandler = null;
  let pending = null;
  let elements = null;

  function build() {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.hidden = true;

    const dialog = document.createElement('div');
    dialog.className = 'dialog glass-surface';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', DIALOG_TITLE_ID);
    dialog.setAttribute('aria-describedby', DIALOG_DESCRIPTION_ID);
    // the container can hold the focus as a fallback, but it is not a tab stop
    dialog.setAttribute('tabindex', '-1');

    const title = document.createElement('h2');
    title.className = 'dialog-title';
    title.id = DIALOG_TITLE_ID;

    const description = document.createElement('p');
    description.className = 'dialog-description';
    description.id = DIALOG_DESCRIPTION_ID;

    const body = document.createElement('div');
    body.className = 'dialog-body';

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-outline';
    cancelButton.setAttribute('data-dialog-action', 'cancel');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => close(false));

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn-primary';
    confirmButton.setAttribute('data-dialog-action', 'confirm');
    confirmButton.addEventListener('click', () => close(true));

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    dialog.appendChild(title);
    dialog.appendChild(description);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    elements = {
      backdrop,
      dialog,
      title,
      description,
      body,
      actions,
      cancelButton,
      confirmButton,
      // The dialog owns its action buttons, so the focus order is known and
      // never depends on a document-wide selector.
      focusable: [cancelButton, confirmButton]
    };
    return elements;
  }

  function focusElement(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus();
    } catch (error) {
      /* a detached or hidden control cannot take focus */
    }
  }

  function isVisible(node) {
    if (!node) return false;
    if (typeof node.getClientRects === 'function') return node.getClientRects().length > 0;
    if (typeof node.getAttribute === 'function' && node.getAttribute('hidden') !== undefined) return false;
    return true;
  }

  function getFocusable() {
    if (!elements) return [];
    return elements.focusable.filter(isVisible);
  }

  /** Keeps Tab inside the dialog: the focus can never reach the page behind it. */
  function trapFocus(event) {
    const focusable = getFocusable();
    if (!focusable.length) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      focusElement(elements ? elements.dialog : null);
      return;
    }

    const active = document.activeElement;
    const index = focusable.indexOf(active);
    if (typeof event.preventDefault === 'function') event.preventDefault();

    if (index === -1) {
      focusElement(event.shiftKey ? focusable[focusable.length - 1] : focusable[0]);
      return;
    }

    const next = event.shiftKey
      ? (index - 1 + focusable.length) % focusable.length
      : (index + 1) % focusable.length;
    focusElement(focusable[next]);
  }

  function handleKeydown(event) {
    if (!pending || !event) return;
    if (event.key === 'Escape') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      close(false);
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  function close(result) {
    if (!pending) return;
    const { resolve, previouslyFocused } = pending;
    pending = null;
    if (elements) {
      elements.backdrop.hidden = true;
      unlockPageScroll();
    }
    focusElement(previouslyFocused);
    resolve(Boolean(result));
  }

  /** The page behind a modal must not scroll while the modal is open. */
  function lockPageScroll() {
    if (typeof document === 'undefined' || !document.body || !document.body.style) return;
    document.body.style.overflow = 'hidden';
  }

  function unlockPageScroll() {
    if (typeof document === 'undefined' || !document.body || !document.body.style) return;
    document.body.style.overflow = '';
  }

  /**
   * Opens the dialog and resolves with the user's answer.
   * @param {{title: string, description?: string, body?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} options
   * @returns {Promise<boolean>} true when the action was confirmed
   */
  function open(options) {
    if (decisionHandler) {
      return Promise.resolve(decisionHandler(options)).then((answer) => Boolean(answer));
    }

    if (!elements) build();
    if (pending) close(false);

    elements.title.textContent = options.title || 'Are you sure?';
    elements.description.textContent = options.description || '';
    elements.description.hidden = !options.description;
    elements.body.innerHTML = options.body || '';
    elements.body.hidden = !options.body;
    elements.confirmButton.textContent = options.confirmLabel || 'Confirm';
    elements.cancelButton.textContent = options.cancelLabel || 'Cancel';
    elements.confirmButton.className = options.danger ? 'btn btn-danger' : 'btn btn-primary';

    const previouslyFocused = document.activeElement;
    elements.backdrop.hidden = false;
    lockPageScroll();

    return new Promise((resolve) => {
      pending = { resolve, previouslyFocused };
      focusElement(elements.confirmButton);
    });
  }

  window.addEventListener('keydown', handleKeydown);

  return {
    open,
    isOpen: () => Boolean(pending),
    accept: () => close(true),
    cancel: () => close(false),
    getElements: () => elements,
    /** Replaces the way an answer is produced. Used by the automated checks. */
    setDecisionHandler(handler) {
      decisionHandler = handler || null;
    }
  };
}

const confirmDialog = createConfirmDialog();

/* ============================================================
   Account access
   The sign-in and registration interface. No authentication
   provider is configured in this build, so the forms validate
   the input and then report honestly that no provider is
   available. A password is never stored, never compared and
   never transmitted, and no local flag is treated as proof of
   a session.
   ============================================================ */

const ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACCOUNT_MIN_PASSWORD_LENGTH = 8;

function createAccountController() {
  const state = {
    mode: 'sign-in',
    status: 'guest',
    user: null,
    provider: null
  };

  let elements = null;

  function collectElements() {
    const byId = (id) => document.getElementById(id);
    elements = {
      view: byId('account-view'),
      heading: byId('account-view-title'),
      openButton: byId('account-btn'),
      closeButton: byId('account-close-btn'),
      session: byId('account-session'),
      sessionText: byId('account-session-text'),
      signOutButton: byId('account-signout-btn'),
      chip: byId('session-chip'),
      shell: document.querySelector('.app-shell'),
      tabs: [byId('account-tab-signin'), byId('account-tab-signup')],
      toggles: {
        signinPassword: byId('account-signin-password-toggle'),
        signupPassword: byId('account-signup-password-toggle'),
        signupConfirm: byId('account-signup-confirm-toggle')
      },
      forms: {
        'sign-in': {
          form: byId('account-panel-signin'),
          email: byId('account-signin-email'),
          password: byId('account-signin-password'),
          emailError: byId('account-signin-email-error'),
          passwordError: byId('account-signin-password-error'),
          feedback: byId('account-signin-feedback'),
          submit: byId('account-signin-submit')
        },
        'sign-up': {
          form: byId('account-panel-signup'),
          email: byId('account-signup-email'),
          password: byId('account-signup-password'),
          confirm: byId('account-signup-confirm'),
          emailError: byId('account-signup-email-error'),
          passwordError: byId('account-signup-password-error'),
          confirmError: byId('account-signup-confirm-error'),
          feedback: byId('account-signup-feedback'),
          submit: byId('account-signup-submit')
        }
      }
    };
    return elements;
  }

  function ensureElements() {
    return elements || collectElements();
  }

  function setFieldError(input, errorElement, message) {
    if (errorElement) {
      errorElement.textContent = message || '';
      errorElement.hidden = !message;
    }
    if (input) {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
  }

  function clearErrors(mode) {
    const fields = ensureElements().forms[mode];
    if (!fields) return;
    setFieldError(fields.email, fields.emailError, '');
    setFieldError(fields.password, fields.passwordError, '');
    if (fields.confirm) setFieldError(fields.confirm, fields.confirmError, '');
  }

  function setFeedback(mode, message, tone) {
    const fields = ensureElements().forms[mode];
    if (!fields || !fields.feedback) return;
    fields.feedback.textContent = message || '';
    fields.feedback.dataset.tone = tone || 'info';
  }

  function setBusy(mode, busy) {
    const fields = ensureElements().forms[mode];
    if (!fields) return;
    if (fields.form) fields.form.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (fields.submit) {
      fields.submit.disabled = Boolean(busy);
      fields.submit.dataset.idleLabel = fields.submit.dataset.idleLabel || fields.submit.textContent || 'Continue';
      fields.submit.textContent = busy ? 'Working…' : fields.submit.dataset.idleLabel;
    }
  }

  /** Field level validation only. It never compares a password with a stored value. */
  function validate(mode, values) {
    const errors = {};
    const email = String((values && values.email) || '').trim();
    const password = String((values && values.password) || '');
    const confirmPassword = String((values && values.confirmPassword) || '');

    if (!email) {
      errors.email = 'Enter your email address.';
    } else if (!ACCOUNT_EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address, for example name@example.com.';
    }

    if (!password) {
      errors.password = 'Enter your password.';
    } else if (password.length < ACCOUNT_MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${ACCOUNT_MIN_PASSWORD_LENGTH} characters.`;
    }

    if (mode === 'sign-up') {
      if (!confirmPassword) {
        errors.confirmPassword = 'Enter the password again.';
      } else if (confirmPassword !== password) {
        errors.confirmPassword = 'The two passwords do not match.';
      }
    }

    return { valid: Object.keys(errors).length === 0, errors, email };
  }

  function showErrors(mode, errors) {
    const fields = ensureElements().forms[mode];
    if (!fields) return;
    setFieldError(fields.email, fields.emailError, errors.email);
    setFieldError(fields.password, fields.passwordError, errors.password);
    if (fields.confirm) setFieldError(fields.confirm, fields.confirmError, errors.confirmPassword);

    const firstInvalid = errors.email ? fields.email : errors.password ? fields.password : fields.confirm;
    if (firstInvalid && typeof firstInvalid.focus === 'function') {
      firstInvalid.focus();
    }
  }

  async function submit(mode, credentials) {
    if (!state.provider) {
      return {
        ok: false,
        code: 'provider-unavailable',
        message:
          mode === 'sign-in'
            ? 'Sign-in is unavailable: no authentication provider is configured for this build. Your plan stays on this device.'
            : 'Account creation is unavailable: no authentication provider is configured for this build. Your plan stays on this device.'
      };
    }

    try {
      const result =
        mode === 'sign-in' ? await state.provider.signIn(credentials) : await state.provider.signUp(credentials);

      if (result && result.ok) {
        state.status = 'signed-in';
        state.user = result.user || { email: credentials.email };
        return { ok: true, message: result.message || 'Signed in.', user: state.user };
      }

      return {
        ok: false,
        code: (result && result.code) || 'failed',
        message: (result && result.message) || 'That did not work. Please try again.'
      };
    } catch (error) {
      console.warn('The account provider could not be reached', error);
      return {
        ok: false,
        code: 'failed',
        message: 'The account service could not be reached. Please try again later.'
      };
    }
  }

  async function handleSubmit(mode, event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const fields = ensureElements().forms[mode];
    if (!fields) return { ok: false, reason: 'missing-elements' };

    clearErrors(mode);
    setFeedback(mode, '');

    const validation = validate(mode, {
      email: fields.email ? fields.email.value : '',
      password: fields.password ? fields.password.value : '',
      confirmPassword: fields.confirm ? fields.confirm.value : ''
    });

    if (!validation.valid) {
      showErrors(mode, validation.errors);
      setFeedback(mode, 'Check the highlighted fields and try again.', 'error');
      return { ok: false, reason: 'validation', errors: validation.errors };
    }

    setBusy(mode, true);
    const result = await submit(mode, { email: validation.email, password: fields.password.value });
    setBusy(mode, false);

    if (!result.ok) {
      setFeedback(mode, result.message, 'error');
      showToast(result.message, 'error');
      return result;
    }

    if (fields.password) fields.password.value = '';
    if (fields.confirm) fields.confirm.value = '';
    setFeedback(mode, result.message, 'success');
    showToast(result.message, 'success');
    renderSession();
    return result;
  }

  function setMode(mode, options) {
    const config = options || {};
    const current = ensureElements();
    state.mode = mode === 'sign-up' ? 'sign-up' : 'sign-in';

    current.tabs.forEach((tab) => {
      if (!tab) return;
      const isActive = tab.id === (state.mode === 'sign-up' ? 'account-tab-signup' : 'account-tab-signin');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    });

    Object.keys(current.forms).forEach((key) => {
      const form = current.forms[key].form;
      if (form) form.hidden = key !== state.mode;
    });

    if (config.focus) {
      const active = current.tabs.find((tab) => tab && tab.getAttribute('aria-selected') === 'true');
      if (active && typeof active.focus === 'function') active.focus();
    }
  }

  function togglePassword(button) {
    if (!button) return;
    const inputId = button.getAttribute('data-password-toggle');
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;
    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    button.setAttribute('aria-pressed', revealed ? 'false' : 'true');
    button.textContent = revealed ? 'Show password' : 'Hide password';
  }

  function focusAccountControl(node) {
    if (!node || typeof node.focus !== 'function') return;
    try {
      node.focus();
    } catch (error) {
      /* a detached or hidden control cannot take focus */
    }
  }

  /**
   * Returns the controls that are currently tabbable inside the account view,
   * in document order. The view hides the calculator and behaves like a modal,
   * so Tab must cycle through these controls instead of reaching the page.
   */
  function getViewFocusControls() {
    const current = ensureElements();
    const controls = [];
    const add = (node, container) => {
      if (!node) return;
      if (node.hidden) return;
      if (container && container.hidden) return;
      if (node.disabled) return;
      controls.push(node);
    };

    add(current.closeButton);
    add(current.signOutButton);
    current.tabs.forEach((tab) => {
      if (!tab) return;
      if (tab.tabIndex === -1) return;
      add(tab);
    });

    const fields = current.forms[state.mode];
    if (fields) {
      add(fields.email, fields.form);
      add(fields.password, fields.form);
      add(state.mode === 'sign-up' ? current.toggles.signupPassword : current.toggles.signinPassword, fields.form);
      if (state.mode === 'sign-up') {
        add(fields.confirm, fields.form);
        add(current.toggles.signupConfirm, fields.form);
      }
      add(fields.submit, fields.form);
    }

    return controls;
  }

  function handleViewKeydown(event) {
    if (!isViewOpen() || !event) return;

    if (event.key === 'Escape') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      closeView();
      return;
    }

    if (event.key !== 'Tab') return;

    const controls = getViewFocusControls();
    if (!controls.length) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();

    const active = document.activeElement;
    const index = controls.indexOf(active);
    const nextIndex =
      index === -1
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : event.shiftKey
          ? (index - 1 + controls.length) % controls.length
          : (index + 1) % controls.length;

    focusAccountControl(controls[nextIndex]);
  }

  function renderSession() {
    const current = ensureElements();
    const signedIn = state.status === 'signed-in' && Boolean(state.user);

    if (current.chip) {
      current.chip.dataset.sessionState = signedIn ? 'signed-in' : 'guest';
      current.chip.textContent = signedIn ? state.user.email : 'Working on this device';
    }

    if (current.session) {
      current.session.dataset.sessionState = signedIn ? 'signed-in' : 'guest';
    }

    if (current.sessionText) {
      current.sessionText.textContent = signedIn
        ? `Signed in as ${state.user.email}.`
        : 'You are working as a guest. Everything stays in this browser.';
    }

    if (current.signOutButton) {
      current.signOutButton.hidden = !signedIn;
    }
  }

  function openView() {
    const current = ensureElements();
    if (current.shell) current.shell.hidden = true;
    if (current.view) current.view.hidden = false;
    renderSession();
    if (current.heading) current.heading.setAttribute('tabindex', '-1');
    focusAccountControl(current.heading);
  }

  function closeView() {
    const current = ensureElements();
    if (current.view) current.view.hidden = true;
    if (current.shell) current.shell.hidden = false;
    if (current.openButton && typeof current.openButton.focus === 'function') {
      current.openButton.focus();
    }
  }

  function isViewOpen() {
    const current = ensureElements();
    return Boolean(current.view && current.view.hidden === false);
  }

  function signOut() {
    const provider = state.provider;
    state.status = 'guest';
    state.user = null;
    renderSession();
    showToast('Signed out. The plan on this device is unchanged.', 'info');
    if (provider && typeof provider.signOut === 'function') {
      try {
        provider.signOut();
      } catch (error) {
        console.warn('The account provider could not sign out', error);
      }
    }
    return { ok: true };
  }

  function bind() {
    const current = collectElements();

    // The markup already declares these states; setting them again keeps the
    // interface correct even when it is restored from a cached page.
    if (current.view) {
      current.view.hidden = true;
      current.view.addEventListener('keydown', handleViewKeydown);
    }
    ['account-signin-password', 'account-signup-password', 'account-signup-confirm'].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.type = 'password';
    });
    setMode('sign-in');

    if (current.openButton) {
      current.openButton.addEventListener('click', () => openView());
    }
    if (current.closeButton) {
      current.closeButton.addEventListener('click', () => closeView());
    }
    if (current.signOutButton) {
      current.signOutButton.addEventListener('click', () => signOut());
    }

    current.tabs.forEach((tab, index) => {
      if (!tab) return;
      tab.addEventListener('click', () => setMode(index === 1 ? 'sign-up' : 'sign-in'));
      tab.addEventListener('keydown', (event) => {
        if (!event) return;
        const key = event.key;
        if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        const nextTab = key === 'Home' ? 0 : key === 'End' ? current.tabs.length - 1 : index === 0 ? 1 : 0;
        setMode(nextTab === 1 ? 'sign-up' : 'sign-in', { focus: true });
      });
    });

    Object.keys(current.forms).forEach((mode) => {
      const fields = current.forms[mode];
      if (fields.form) {
        fields.form.addEventListener('submit', (event) => {
          handleSubmit(mode, event);
        });
      }
    });

    const toggles = [
      { button: document.getElementById('account-signin-password-toggle'), input: 'account-signin-password' },
      { button: document.getElementById('account-signup-password-toggle'), input: 'account-signup-password' },
      { button: document.getElementById('account-signup-confirm-toggle'), input: 'account-signup-confirm' }
    ];
    toggles.forEach((toggle) => {
      if (!toggle.button) return;
      toggle.button.setAttribute('aria-pressed', 'false');
      toggle.button.textContent = 'Show password';
      toggle.button.addEventListener('click', () => {
        const input = document.getElementById(toggle.input);
        if (!input) return;
        const revealed = input.type === 'text';
        input.type = revealed ? 'password' : 'text';
        toggle.button.setAttribute('aria-pressed', revealed ? 'false' : 'true');
        toggle.button.textContent = revealed ? 'Show password' : 'Hide password';
      });
    });

    renderSession();
  }

  return {
    bind,
    openView,
    closeView,
    isViewOpen,
    signOut,
    setMode,
    validate,
    handleSubmit,
    togglePassword,
    renderSession,
    getState: () => ({ mode: state.mode, status: state.status, user: state.user, providerConfigured: Boolean(state.provider) }),
    /** Replaces the authentication provider. Used by the automated checks. */
    setProvider(provider) {
      state.provider = provider || null;
      renderSession();
    }
  };
}

const accountController = createAccountController();

/* ============================================================
   Backup and restore
   Exports the saved plan as a versioned JSON document and
   restores one only after it has been validated, previewed and
   confirmed, and only after a recoverable copy of the current
   plan has been written.
   ============================================================ */

function createBackupController() {
  let elements = null;

  function collectElements() {
    const byId = (id) => document.getElementById(id);
    elements = {
      exportButton: byId('export-backup-btn'),
      importButton: byId('import-backup-btn'),
      importInput: byId('import-backup-input'),
      note: byId('data-note')
    };
    return elements;
  }

  function ensureElements() {
    return elements || collectElements();
  }

  function buildBackupDocument() {
    return SgpaCalculator.createBackup({
      semesters: appState.semesters,
      selectedSemesterId: appState.selectedSemesterId,
      selectedGradingSystem: appState.selectedGradingSystem
    });
  }

  function exportBackup() {
    let text = '';
    let fileName = '';

    try {
      const backup = buildBackupDocument();
      text = JSON.stringify(backup, null, 2);
      const stamp = new Date().toISOString().slice(0, 10);
      fileName = `sgpa-cgpa-backup-${stamp}.json`;
    } catch (error) {
      console.warn('Could not build the backup', error);
      showToast('The backup could not be created.', 'error');
      return { ok: false, reason: 'serialise' };
    }

    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          /* the object URL is released when the page goes away */
        }
      }, 0);
      showToast('Backup file downloaded.', 'success');
      return { ok: true, fileName, bytes: text.length };
    } catch (error) {
      console.warn('Could not download the backup', error);
      showToast('The backup could not be downloaded.', 'error');
      return { ok: false, reason: 'download' };
    }
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('no file was selected'));
        return;
      }
      if (typeof FileReader === 'function') {
        const reader = new FileReader();
        reader.onload = () => resolve(String((reader && reader.result) || ''));
        reader.onerror = () => reject((reader && reader.error) || new Error('the file could not be read'));
        reader.readAsText(file);
        return;
      }
      if (typeof file.text === 'function') {
        file.text().then(resolve, reject);
        return;
      }
      reject(new Error('this browser cannot read the selected file'));
    });
  }

  /** Restores a validated backup. The caller has already confirmed the change. */
  function applyBackup(backup) {
    const previous = {
      semesters: appState.semesters,
      selectedSemesterId: appState.selectedSemesterId,
      selectedGradingSystem: appState.selectedGradingSystem
    };
    const previousRaw = readStoredValue(STORAGE_KEY);

    try {
      if (previousRaw !== null) {
        if (!writeStoredValue(RECOVERY_KEY, previousRaw)) {
          showToast('The current plan could not be backed up, so the import was stopped.', 'error');
          return { ok: false, reason: 'backup-failed' };
        }
      }
    } catch (error) {
      console.warn('Could not back up the current plan', error);
      showToast('The current plan could not be backed up, so the import was stopped.', 'error');
      return { ok: false, reason: 'backup-failed' };
    }

    const result = SgpaCalculator.sanitizeSavedState(backup.plan, {
      createId,
      fallbackSystem: previous.selectedGradingSystem
    });

    if (result.unrecoverable) {
      showToast('The backup could not be restored, so nothing was changed.', 'error');
      return { ok: false, reason: 'unrecoverable' };
    }

    appState.semesters = result.semesters;
    appState.selectedSemesterId = result.selectedSemesterId;
    appState.selectedGradingSystem = result.selectedGradingSystem;
    if (appElements.gradingSystemPicker) {
      appElements.gradingSystemPicker.value = result.selectedGradingSystem;
    }

    if (!saveState()) {
      appState.semesters = previous.semesters;
      appState.selectedSemesterId = previous.selectedSemesterId;
      appState.selectedGradingSystem = previous.selectedGradingSystem;
      if (appElements.gradingSystemPicker) {
        appElements.gradingSystemPicker.value = previous.selectedGradingSystem;
      }
      renderSemesters();
      updateSummaryPanel();
      showToast('The backup could not be saved, so the current plan was kept.', 'error');
      return { ok: false, reason: 'write-failed' };
    }

    renderSemesters();
    updateSummaryPanel();
    showToast('Backup restored.', 'success');
    return { ok: true };
  }

  async function importBackupFile(file) {
    let text = '';
    try {
      text = await readFileText(file);
    } catch (error) {
      console.warn('Could not read the backup file', error);
      showToast('The backup file could not be read.', 'error');
      return { ok: false, reason: 'read' };
    }

    const parsed = SgpaCalculator.parseBackup(text);
    if (!parsed.ok) {
      showToast(parsed.error.message, 'error');
      return { ok: false, reason: parsed.error.code };
    }

    const summary = SgpaCalculator.summarizeBackup(parsed.backup);
    const confirmed = await confirmDialog.open({
      title: 'Replace the current plan?',
      description: `The backup holds ${summary.semesters} semester(s) and ${summary.subjects} subject(s) for ${summary.gradingSystemName}. A copy of the current plan is kept on this device first, so the change can be undone.`,
      confirmLabel: 'Replace plan',
      danger: true
    });

    if (!confirmed) {
      return { ok: false, reason: 'cancelled' };
    }

    return applyBackup(parsed.backup);
  }

  function bind() {
    const current = collectElements();

    if (current.exportButton) {
      current.exportButton.addEventListener('click', () => exportBackup());
    }

    if (current.importButton && current.importInput) {
      current.importButton.addEventListener('click', () => {
        if (typeof current.importInput.click === 'function') current.importInput.click();
      });
    }

    if (current.importInput) {
      current.importInput.addEventListener('change', async () => {
        const file = current.importInput.files && current.importInput.files.length ? current.importInput.files[0] : null;
        if (!file) return;
        await importBackupFile(file);
        current.importInput.value = '';
      });
    }
  }

  return {
    bind,
    exportBackup,
    importBackupFile,
    applyBackup,
    buildBackupDocument,
    readFileText
  };
}

const backupController = createBackupController();

// Browser storage can be unavailable or full (private windows, exhausted quota).
// Reads fall back to "no saved value" and writes report failure once instead of
// throwing, so the app stays usable instead of aborting during initialisation.
function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('Could not read browser storage', error);
    return null;
  }
}

/**
 * The single place that writes to browser storage. It reports success instead
 * of throwing, so a full or unavailable storage never breaks the app.
 */
function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('Could not write to browser storage', error);
    return false;
  }
}

function persistStoredValue(key, value) {
  if (writeStoredValue(key, value)) {
    return true;
  }

  if (!storageWarningShown) {
    storageWarningShown = true;
    console.warn('Could not write to browser storage; changes are kept in memory only');
    showToast('Browser storage is unavailable, so changes cannot be saved in this session.', 'warn');
  }
  return false;
}
appState = loadState();

function createId() {
  return crypto?.randomUUID?.() || `id-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function defaultSubject(systemId) {
  return { id: createId(), name: 'New Subject', credit: 3, grade: getDefaultGradeLabel(systemId) };
}

function defaultSemester(index = 1, systemId) {
  const fallbackGrade = getDefaultGradeLabel(systemId);
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
  const legacySystem = readStoredValue('sgpaCgpaGradingSystem');
  const selectedGradingSystem = gradingSystems[legacySystem] ? legacySystem : 'standard-btech';
  const semesters = [defaultSemester(1, selectedGradingSystem)];
  return {
    theme: readStoredValue(THEME_KEY) || DEFAULT_THEME,
    semesters,
    selectedSemesterId: semesters[0].id,
    selectedGradingSystem
  };
}

/**
 * Keeps a verbatim copy of saved data that could not be read, so replacing it
 * with a fresh plan never destroys the only copy.
 * @returns {boolean} true when a copy was stored
 */
function preserveUnreadableState(raw) {
  if (typeof raw !== 'string' || raw === '') return false;
  return writeStoredValue(RECOVERY_KEY, raw);
}

function loadState() {
  try {
    const raw = readStoredValue(STORAGE_KEY);
    if (raw !== null) {
      const saved = JSON.parse(raw);
      const result = SgpaCalculator.sanitizeSavedState(saved, {
        createId,
        fallbackSystem: readStoredValue('sgpaCgpaGradingSystem')
      });

      if (!result.unrecoverable) {
        if (result.repaired) {
          stateRecoveryNotice = 'Some saved data was repaired so the calculator could load.';
        }
        return {
          theme: readStoredValue(THEME_KEY) || DEFAULT_THEME,
          semesters: result.semesters,
          selectedSemesterId: result.selectedSemesterId,
          selectedGradingSystem: result.selectedGradingSystem
        };
      }

      const preserved = preserveUnreadableState(raw);
      stateRecoveryNotice = preserved
        ? 'Saved data could not be read. A copy was kept on this device, so nothing was lost.'
        : 'Saved data could not be read. Started with a fresh academic plan.';
    }
  } catch (error) {
    console.warn('Could not parse saved state', error);
    const raw = readStoredValue(STORAGE_KEY);
    const preserved = preserveUnreadableState(raw);
    stateRecoveryNotice = preserved
      ? 'Saved data could not be read. A copy was kept on this device, so nothing was lost.'
      : 'Saved data could not be read. Started with a fresh academic plan.';
  }
  return buildInitialState();
}

function saveState() {
  const saved = persistStoredValue(
    STORAGE_KEY,
    JSON.stringify({
      semesters: appState.semesters,
      selectedSemesterId: appState.selectedSemesterId,
      selectedGradingSystem: appState.selectedGradingSystem
    })
  );
  persistStoredValue('sgpaCgpaGradingSystem', appState.selectedGradingSystem);
  return saved;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (!themeList.includes(theme)) {
    theme = DEFAULT_THEME;
  }
  root.dataset.theme = theme;
  if (appElements.themePicker) {
    appElements.themePicker.value = theme;
  }
  persistStoredValue(THEME_KEY, theme);
  appState.theme = theme;
}

async function applyGradingSystem(systemId) {
  if (!gradingSystems[systemId]) {
    if (appElements.gradingSystemPicker) {
      appElements.gradingSystemPicker.value = appState.selectedGradingSystem;
    }
    return 'rejected';
  }

  const previousSystem = appState.selectedGradingSystem;
  const subjects = appState.semesters.reduce((all, semester) => all.concat(semester.subjects), []);
  const plan = SgpaCalculator.planGradingSystemChange(subjects, systemId, previousSystem);

  if (!plan.known) {
    if (appElements.gradingSystemPicker) {
      appElements.gradingSystemPicker.value = previousSystem;
    }
    return 'rejected';
  }

  if (plan.requiresConfirmation) {
    const details = [];

    if (plan.valueChanges.length) {
      details.push(
        '<p class="dialog-list-title">Point values change for:</p>' +
          '<ul class="dialog-list">' +
          plan.valueChanges
            .map(
              (change) =>
                `<li><span class="dialog-list-name">${escapeHtml(change.name)}</span><span class="dialog-list-detail">${escapeHtml(
                  change.label
                )} (${escapeHtml(formatGradeValue(change.fromValue))} to ${escapeHtml(
                  formatGradeValue(change.toValue)
                )})</span></li>`
            )
            .join('') +
          '</ul>'
      );
    }

    if (plan.unknown.length) {
      details.push(
        `<p class="dialog-list-title">Not available in ${escapeHtml(gradingSystems[systemId].name)} (kept unchanged, no automatic replacement):</p>` +
          '<ul class="dialog-list">' +
          plan.unknown
            .map(
              (change) =>
                `<li><span class="dialog-list-name">${escapeHtml(change.name)}</span><span class="dialog-list-detail">${escapeHtml(
                  change.label
                )}</span></li>`
            )
            .join('') +
          '</ul>'
      );
    }

    const confirmed = await confirmDialog.open({
      title: `Switch to ${gradingSystems[systemId].name}?`,
      description:
        'Grades are never replaced automatically. Unsupported grades stay as they are and are marked incomplete.',
      body: details.join(''),
      confirmLabel: 'Switch grading system',
      cancelLabel: 'Keep current system'
    });

    if (!confirmed) {
      if (appElements.gradingSystemPicker) {
        appElements.gradingSystemPicker.value = previousSystem;
      }
      return 'cancelled';
    }
  }

  appState.selectedGradingSystem = systemId;
  if (appElements.gradingSystemPicker) {
    appElements.gradingSystemPicker.value = systemId;
  }
  saveState();
  renderCurrentSemesterCard();
  updateSummaryPanel();
  return 'applied';
}

function formatGradeValue(value) {
  return value === null || value === undefined ? 'n/a' : value;
}

function getSemesterMetrics(semester) {
  return SgpaCalculator.computeSemesterMetrics(semester.subjects, appState.selectedGradingSystem);
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

function preserveScrollPosition(action) {
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  action();
  window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
}

function renderCurrentSemesterCard() {
  const semester = getSelectedSemester();
  if (!semester) return;

  const card = createSemesterCard(semester);
  const existingCard = appElements.semesterList.querySelector('.semester-card');

  if (existingCard) {
    appElements.semesterList.replaceChild(card, existingCard);
  } else {
    appElements.semesterList.appendChild(card);
  }
}

function getSummaryStats() {
  return SgpaCalculator.computeSummary(appState.semesters, appState.selectedGradingSystem);
}

function determineAward(cgpa, context) {
  return SgpaCalculator.determineAward(cgpa, context);
}

function createSemesterCard(semester) {
  const card = document.createElement('section');
  card.className = 'semester-card';
  card.dataset.semesterId = semester.id;
  card.innerHTML = `
    <div class="semester-meta">
      <div>
        <h3>${escapeHtml(semester.title)}</h3>
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
  const usedControlIds = new Set();

  semester.subjects.forEach((subject) => {
    const controlIds = SgpaCalculator.createSubjectControlIds(semester.id, subject.id, usedControlIds);
    const row = document.createElement('div');
    row.className = 'subject-row';
    row.innerHTML = `
      <div class="subject-cell subject-name-cell">
        <label for="${escapeHtml(controlIds.name)}">Subject</label>
        <input id="${escapeHtml(controlIds.name)}" class="subject-name" type="text" aria-label="${escapeHtml(subjectControlLabel('Subject name', subject))}" />
      </div>
      <div class="subject-cell subject-meta-cell">
        <label for="${escapeHtml(controlIds.grade)}">Grade</label>
        <select id="${escapeHtml(controlIds.grade)}" class="subject-grade" aria-describedby="${escapeHtml(controlIds.gradeError)}" aria-label="${escapeHtml(subjectControlLabel('Grade', subject))}">${getGradeOptions()}</select>
        <p class="field-error grade-error" id="${escapeHtml(controlIds.gradeError)}" role="status" hidden>This grade is not available in the current grading system. Choose a supported grade or switch systems.</p>
        <label for="${escapeHtml(controlIds.credit)}">Credits</label>
        <input id="${escapeHtml(controlIds.credit)}" class="subject-credit" type="number" min="0" step="any" aria-describedby="${escapeHtml(controlIds.creditError)}" aria-label="${escapeHtml(subjectControlLabel('Credits', subject))}" />
        <p class="field-error" id="${escapeHtml(controlIds.creditError)}" role="status" hidden>Credit must be a number greater than or equal to 0.</p>
      </div>
      <button class="row-action" type="button" aria-label="Remove subject">Remove</button>
    `;

    const nameInput = row.querySelector('.subject-name');
    const gradeInput = row.querySelector('.subject-grade');
    const gradeError = row.querySelector('.grade-error');
    const creditInput = row.querySelector('.subject-credit');
    const creditError = row.querySelector('.field-error:not(.grade-error)');
    const removeBtn = row.querySelector('.row-action');

    nameInput.value = subject.name ?? '';
    creditInput.value = subject.credit ?? '';

    if (Object.prototype.hasOwnProperty.call(getCurrentGradeScale(), subject.grade)) {
      gradeInput.value = subject.grade;
    } else {
      const unsupportedOption = document.createElement('option');
      unsupportedOption.value = subject.grade ?? '';
      unsupportedOption.textContent = `${subject.grade} (unsupported)`;
      unsupportedOption.dataset.unsupported = 'true';
      unsupportedOption.selected = true;
      gradeInput.appendChild(unsupportedOption);
      gradeInput.value = subject.grade ?? '';
    }
    refreshGradeSupport(gradeInput, gradeError);
    refreshCreditValidation(creditInput, creditError);

    function updateSubject() {
      subject.name = nameInput.value;
      const creditResult = refreshCreditValidation(creditInput, creditError);
      subject.credit = creditResult.valid ? creditResult.value : creditInput.value;
      subject.grade = gradeInput.value;
      nameInput.setAttribute('aria-label', subjectControlLabel('Subject name', subject));
      gradeInput.setAttribute('aria-label', subjectControlLabel('Grade', subject));
      creditInput.setAttribute('aria-label', subjectControlLabel('Credits', subject));
      refreshGradeSupport(gradeInput, gradeError);
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
      renderCurrentSemesterCard();
      updateSummaryPanel();
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
  const existingTabs = Array.from(appElements.semesterTabs.children);
  const currentIds = appState.semesters.map((semester) => semester.id);
  const needsRebuild = existingTabs.length !== currentIds.length || existingTabs.some((tab, index) => tab.dataset.semesterId !== currentIds[index]);

  if (!needsRebuild) {
    existingTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.semesterId === appState.selectedSemesterId);
    });
    return;
  }

  appElements.semesterTabs.innerHTML = '';
  appState.semesters.forEach((semester, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `semester-tab${semester.id === appState.selectedSemesterId ? ' active' : ''}`;
    tab.textContent = `S${index + 1}`;
    tab.dataset.semesterId = semester.id;
    tab.addEventListener('click', () => {
      if (appState.selectedSemesterId === semester.id) return;
      setSelectedSemester(semester.id);
      renderSemesters();
    });
    appElements.semesterTabs.appendChild(tab);
  });
}

function renderSemesters() {
  preserveScrollPosition(() => {
    renderSemesterTabs();
    renderCurrentSemesterCard();
    updateSummaryPanel();
  });
}

function refreshGradeSupport(gradeInput, gradeError) {
  const supported = Object.prototype.hasOwnProperty.call(getCurrentGradeScale(), gradeInput.value);

  if (supported) {
    gradeInput.removeAttribute('aria-invalid');
    Array.from(gradeInput.querySelectorAll('option[data-unsupported="true"]')).forEach((option) => {
      if (option.value !== gradeInput.value) option.remove();
    });
    if (gradeError) gradeError.hidden = true;
  } else {
    gradeInput.setAttribute('aria-invalid', 'true');
    if (gradeError) gradeError.hidden = false;
  }

  return supported;
}

function refreshCreditValidation(creditInput, errorEl) {
  const result = SgpaCalculator.parseCredit(creditInput.value);
  if (result.valid) {
    creditInput.removeAttribute('aria-invalid');
    if (errorEl) errorEl.hidden = true;
  } else {
    creditInput.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.hidden = false;
  }
  return result;
}

function ensureValidationBanner() {
  let banner = document.getElementById('validation-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'validation-banner';
    banner.className = 'validation-banner';
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    const grid = document.querySelector('.summary-grid');
    if (grid) {
      grid.insertAdjacentElement('afterend', banner);
    } else {
      document.querySelector('.app-shell')?.appendChild(banner);
    }
  }
  return banner;
}

function updateValidationBanner() {
  const banner = ensureValidationBanner();
  const report = SgpaCalculator.getIncompleteReport(appState.semesters, appState.selectedGradingSystem);
  const problems = [];

  if (report.invalidCreditCount > 0) {
    problems.push(`${report.invalidCreditCount} ${report.invalidCreditCount === 1 ? 'subject has an' : 'subjects have an'} invalid credit value`);
  }

  if (report.unsupportedGradeCount > 0) {
    const systemName = gradingSystems[appState.selectedGradingSystem]?.name || 'the current grading system';
    problems.push(
      `${report.unsupportedGradeCount} ${report.unsupportedGradeCount === 1 ? 'subject has a grade' : 'subjects have grades'} not available in ${systemName}`
    );
  }

  const grid = document.querySelector('.summary-grid');
  if (report.incomplete) {
    banner.textContent = `Results incomplete: ${problems.join('; ')}. Those subjects are not counted correctly until corrected.`;
    banner.hidden = false;
  } else {
    banner.textContent = '';
    banner.hidden = true;
  }
  if (grid) grid.classList.toggle('results-incomplete', report.incomplete);
}

function updateSummaryPanel() {
  const summary = getSummaryStats();
  const latestSemester = appState.semesters[appState.semesters.length - 1];
  const latestMetrics = latestSemester ? getSemesterMetrics(latestSemester) : null;
  const hasLatestSgpa = Boolean(latestMetrics && latestMetrics.totalCredits > 0);

  appElements.summarySubjects.textContent = summary.totalSubjects;
  appElements.summaryCurrentSgpa.textContent = hasLatestSgpa ? summary.currentSgpa.toFixed(2) : 'N/A';
  appElements.summaryCredits.textContent = summary.totalCredits;
  appElements.overallCgpa.textContent = summary.overallCgpa.toFixed(2);
  appElements.summaryPercent.textContent = `${summary.overallPercent.toFixed(2)}%`;
  appElements.bestSgpa.textContent = summary.bestSgpa.toFixed(2);
  appElements.worstSgpa.textContent = summary.worstSgpa.toFixed(2);
  appElements.avgSgpa.textContent = summary.averageSgpa.toFixed(2);
  const incomplete = SgpaCalculator.getIncompleteReport(appState.semesters, appState.selectedGradingSystem);
  appElements.awardLabel.textContent = determineAward(summary.overallCgpa, {
    hasSemesterData: appState.semesters.length > 0,
    incomplete: incomplete.incomplete
  });
  updateValidationBanner();
  renderTrendChart();
}

function getTrendSeries() {
  return appState.semesters.map((semester) => {
    const metrics = getSemesterMetrics(semester);
    const usable = metrics.totalCredits > 0;
    return {
      title: semester.title,
      usable,
      sgpa: usable ? Number(metrics.sgpa) : null
    };
  });
}

function buildTrendChartMarkup(series) {
  const width = 320;
  const height = 160;
  const padX = 24;
  const padTop = 16;
  const padBottom = 28;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const maxSgpa = 10;
  const count = series.length;
  const xFor = (index) => padX + (count > 1 ? (plotW * index) / (count - 1) : plotW / 2);
  const yFor = (sgpa) => padTop + plotH - (Math.min(maxSgpa, Math.max(0, sgpa)) / maxSgpa) * plotH;

  const gridlines = [0, 5, 10]
    .map((value) => {
      const y = yFor(value).toFixed(1);
      return (
        `<line class="trend-grid" x1="${padX}" y1="${y}" x2="${padX + plotW}" y2="${y}" />` +
        `<text class="trend-axis-label" x="6" y="${(Number(y) + 3).toFixed(1)}">${value}</text>`
      );
    })
    .join('');

  let segments = '';
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    if (previous.usable && current.usable) {
      segments += `<line class="trend-line" x1="${xFor(index - 1).toFixed(1)}" y1="${yFor(previous.sgpa).toFixed(1)}" x2="${xFor(index).toFixed(1)}" y2="${yFor(current.sgpa).toFixed(1)}" />`;
    }
  }

  const points = series
    .map((point, index) =>
      point.usable
        ? `<circle class="trend-point" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.sgpa).toFixed(1)}" r="4"><title>${escapeHtml(point.title)}: ${point.sgpa.toFixed(2)}</title></circle>`
        : ''
    )
    .join('');

  const ticks = series
    .map(
      (point, index) =>
        `<text class="trend-axis-label trend-axis-label-x" x="${xFor(index).toFixed(1)}" y="${height - 8}" text-anchor="middle">${index + 1}</text>`
    )
    .join('');

  return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${gridlines}${segments}${points}${ticks}</svg>`;
}

function renderTrendChart() {
  if (!appElements.trendChart || !appElements.trendTableBody) return;

  const series = getTrendSeries();
  const usableCount = series.filter((point) => point.usable).length;

  appElements.trendTableBody.innerHTML = series
    .map(
      (point) =>
        `<tr><th scope="row">${escapeHtml(point.title)}</th><td>${point.usable ? point.sgpa.toFixed(2) : 'N/A'}</td></tr>`
    )
    .join('');

  if (usableCount === 0) {
    appElements.trendChart.innerHTML = `<p class="trend-empty-text">${
      appState.semesters.length === 0
        ? 'Add a semester to see your SGPA trend.'
        : 'No usable SGPA yet - add subjects with valid credits.'
    }</p>`;
    return;
  }

  const note = usableCount === 1 ? '<p class="trend-note">Add another semester to see a trend line.</p>' : '';
  appElements.trendChart.innerHTML = buildTrendChartMarkup(series) + note;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} glass-surface`;
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${type === 'success' ? '✔' : type === 'error' ? '✖' : type === 'warn' ? '⚠' : 'ℹ'}</span>
    <div class="toast-message"></div>
  `;
  toast.querySelector('.toast-message').textContent = message;
  appElements.toastContainer.appendChild(toast);
  trimToastStack();
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => toast.classList.remove('visible'), 4200);
  setTimeout(() => toast.remove(), 4600);
}

/**
 * Keeps the notification stack short. On a 375 px screen four stacked toasts
 * cover the KPI cards, so the oldest notification is dropped as soon as a new
 * one arrives.
 */
function trimToastStack() {
  const container = appElements.toastContainer;
  if (!container || !container.children) return;

  while (container.children.length > MAX_VISIBLE_TOASTS) {
    const oldest = container.children[0];
    if (!oldest) break;
    if (typeof container.removeChild === 'function') {
      container.removeChild(oldest);
    } else if (typeof oldest.remove === 'function') {
      oldest.remove();
    }
  }
}

function resetAllData() {
  appState.semesters = [defaultSemester(1)];
  saveState();
  renderSemesters();
  showToast('All data cleared. Start a fresh academic plan.');
}

function copySummary() {
  const summary = getSummaryStats();
  const incomplete = SgpaCalculator.getIncompleteReport(appState.semesters, appState.selectedGradingSystem);
  let text = `Semesters: ${summary.semesterCount}\nCGPA: ${summary.overallCgpa.toFixed(2)}\nPercentage: ${summary.overallPercent.toFixed(2)}%\nCredits: ${summary.totalCredits}`;

  if (incomplete.incomplete) {
    const issues = [];
    if (incomplete.invalidCreditCount > 0) {
      issues.push(`${incomplete.invalidCreditCount} invalid credit entr${incomplete.invalidCreditCount === 1 ? 'y' : 'ies'}`);
    }
    if (incomplete.unsupportedGradeCount > 0) {
      issues.push(`${incomplete.unsupportedGradeCount} unsupported grade${incomplete.unsupportedGradeCount === 1 ? '' : 's'}`);
    }
    text += `\n\nWARNING: Results may be incomplete or misleading. ${issues.join(', ')} must be corrected before relying on these figures.`;
  }

  navigator.clipboard
    .writeText(text)
    .then(() => showToast('Summary copied to clipboard', 'success'))
    .catch(() => showToast('Unable to copy summary', 'error'));
}

/**
 * Builds the printable report from the current application state.
 * The report is a separate element, so the dashboard is never replaced and the
 * plan on screen is left exactly as it was.
 */
function buildReportElement() {
  const summary = getSummaryStats();
  const gradingName = gradingSystems[appState.selectedGradingSystem]?.name || 'Standard B.Tech';
  const incomplete = SgpaCalculator.getIncompleteReport(appState.semesters, appState.selectedGradingSystem);
  const scale = getCurrentGradeScale();
  const latestSemester = appState.semesters[appState.semesters.length - 1];
  const latestMetrics = latestSemester ? getSemesterMetrics(latestSemester) : null;
  const hasLatestSgpa = Boolean(latestMetrics && latestMetrics.totalCredits > 0);

  const report = document.createElement('div');
  report.className = 'pdf-report print-only';
  report.id = 'print-report';
  report.setAttribute('role', 'document');

  const incompleteNotice = incomplete.incomplete
    ? `
    <div class="pdf-warning" role="note">
      <h2>Incomplete results</h2>
      <p>The figures in this report may be incomplete or misleading until the issues below are corrected.</p>
      <ul>
        ${incomplete.invalidCreditCount > 0 ? `<li>${escapeHtml(incomplete.invalidCreditCount)} subject entr${incomplete.invalidCreditCount === 1 ? 'y' : 'ies'} with an invalid credit value ${incomplete.invalidCreditCount === 1 ? 'was' : 'were'} excluded from the totals.</li>` : ''}
        ${incomplete.unsupportedGradeCount > 0 ? `<li>${escapeHtml(incomplete.unsupportedGradeCount)} subject entr${incomplete.unsupportedGradeCount === 1 ? 'y' : 'ies'} with a grade not available in ${escapeHtml(gradingName)} ${incomplete.unsupportedGradeCount === 1 ? 'was' : 'were'} counted as 0 points.</li>` : ''}
      </ul>
      <p>Grades are never replaced automatically. Correct the flagged subjects before relying on these results.</p>
    </div>`
    : '';

  const summaryTiles = [
    ['Semesters', String(summary.semesterCount)],
    ['CGPA', summary.overallCgpa.toFixed(2)],
    ['Percentage', `${summary.overallPercent.toFixed(2)}%`],
    ['Total Credits', String(summary.totalCredits)],
    ['Total Subjects', String(summary.totalSubjects)],
    ['Latest Semester SGPA', hasLatestSgpa ? summary.currentSgpa.toFixed(2) : 'N/A'],
    ['Best SGPA', summary.bestSgpa.toFixed(2)],
    ['Lowest SGPA', summary.worstSgpa.toFixed(2)],
    ['Semester Average', summary.averageSgpa.toFixed(2)]
  ];

  const award = determineAward(summary.overallCgpa, {
    hasSemesterData: appState.semesters.length > 0,
    incomplete: incomplete.incomplete
  });

  const semesterHtml = appState.semesters
    .map((semester) => {
      const semesterMetrics = getSemesterMetrics(semester);
      const rows = semester.subjects
        .map((subject) => {
          /*
           * Only an own property of the scale is a grade. A label such as
           * "constructor" or "toString" must never resolve to an inherited
           * object member, which would print a function as a point value.
           */
          const supported = Object.prototype.hasOwnProperty.call(scale, subject.grade);
          const value = supported ? scale[subject.grade] : 0;
          const gradeLabel = supported ? escapeHtml(subject.grade) : `${escapeHtml(subject.grade)} (unsupported)`;
          return `
            <tr>
              <td>${escapeHtml(subject.name)}</td>
              <td>${gradeLabel}</td>
              <td>${escapeHtml(subject.credit)}</td>
              <td>${escapeHtml(String(value))}</td>
            </tr>`;
        })
        .join('');

      return `
        <section class="pdf-section">
          <h3>${escapeHtml(semester.title)}</h3>
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
      <h1>SGPA &amp; CGPA Report</h1>
      <p>Grading system: ${escapeHtml(gradingName)}</p>
      <p>Date: ${new Date().toLocaleDateString()}</p>
      <div class="pdf-summary">
        ${summaryTiles.map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')}
      </div>
      <p class="pdf-award"><strong>Performance Note:</strong> ${escapeHtml(award)}</p>
    </div>
    ${incompleteNotice}
    ${semesterHtml}
  `;

  return report;
}

let activePrintReport = null;

/** Removes a report element from the document, whichever way it is attached. */
function detachReport(report) {
  if (!report) return;
  if (report.parentNode && typeof report.parentNode.removeChild === 'function') {
    report.parentNode.removeChild(report);
    return;
  }
  if (document.body && typeof document.body.removeChild === 'function') {
    document.body.removeChild(report);
  }
}

function removePrintReport() {
  if (!activePrintReport) return;
  const { report, cleanup } = activePrintReport;
  activePrintReport = null;
  if (typeof cleanup === 'function') cleanup();
  detachReport(report);
}

/**
 * Opens the browser's print dialog for the printable report. The browser
 * decides what happens with the document: the user picks a printer or
 * "Save as PDF". Nothing is downloaded automatically, so no success message
 * is shown.
 */
function printReport() {
  removePrintReport();

  let report;
  try {
    report = buildReportElement();
  } catch (error) {
    console.warn('Could not build the printable report', error);
    showToast('The report could not be prepared for printing.', 'error');
    return { ok: false, reason: 'build' };
  }

  try {
    document.body.appendChild(report);
  } catch (error) {
    console.warn('The printable report could not be attached', error);
    showToast('The report could not be prepared for printing.', 'error');
    return { ok: false, reason: 'append' };
  }

  let cleaned = false;
  let fallbackTimer = null;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer !== null && typeof clearTimeout === 'function') clearTimeout(fallbackTimer);
    fallbackTimer = null;
    window.removeEventListener('afterprint', cleanup);
    if (activePrintReport && activePrintReport.cleanup === cleanup) {
      activePrintReport = null;
    }
    detachReport(report);
  };

  activePrintReport = { report, cleanup };
  window.addEventListener('afterprint', cleanup);
  /*
   * afterprint is the normal cleanup path. The timer only covers an engine that
   * never delivers it, so it is deliberately long: removing the report while a
   * print dialog is still open could blank that dialog's preview.
   */
  fallbackTimer = setTimeout(cleanup, 10 * 60 * 1000);

  if (typeof window.print !== 'function') {
    cleanup();
    showToast('Printing is not available in this browser.', 'error');
    return { ok: false, reason: 'unavailable' };
  }

  showToast("The print dialog is open — choose 'Save as PDF' as the destination.", 'info');

  try {
    window.print();
  } catch (error) {
    console.warn('The print dialog could not be opened', error);
    cleanup();
    showToast('The print dialog could not be opened.', 'error');
    return { ok: false, reason: 'print' };
  }

  return { ok: true };
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

async function deleteSelectedSemester() {
  const semester = getSelectedSemester();
  if (!semester) return;
  if (appState.semesters.length === 1) {
    showToast('At least one semester is required.');
    return;
  }

  const confirmed = await confirmDialog.open({
    title: `Delete ${semester.title}?`,
    description: `This removes ${semester.title} and all of its subjects from the plan. This cannot be undone.`,
    confirmLabel: 'Delete semester',
    danger: true
  });

  if (!confirmed) return;

  appState.semesters = appState.semesters.filter((item) => item.id !== semester.id);
  appState.selectedSemesterId = appState.semesters[0]?.id || null;
  saveState();
  renderSemesters();
  showToast('Semester removed.');
}

function setActiveNavItem(targetId) {
  document.querySelectorAll('.bottom-nav .nav-pill').forEach((item) => {
    const isActive = item.getAttribute('href') === `#${targetId}`;
    item.classList.toggle('active', isActive);

    if (isActive) {
      item.setAttribute('aria-current', 'location');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}

function syncActiveNavFromHash() {
  const targetId = (window.location.hash || '').replace(/^#/, '');
  if (targetId) {
    setActiveNavItem(targetId);
  }
}

function setupEventListeners() {
  accountController.bind();
  backupController.bind();

  document.querySelectorAll('.bottom-nav .nav-pill').forEach((item) => {
    item.addEventListener('click', () => {
      const href = item.getAttribute('href') || '';
      if (href.startsWith('#')) {
        setActiveNavItem(href.slice(1));
      }
    });
  });

  window.addEventListener('hashchange', syncActiveNavFromHash);
  syncActiveNavFromHash();

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
    renderCurrentSemesterCard();
    updateSummaryPanel();
    showToast('Subject added to current semester.');
  });

  appElements.deleteSemesterBtn.addEventListener('click', deleteSelectedSemester);

  appElements.resetAllBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog.open({
      title: 'Reset all data?',
      description: 'Every semester and subject is removed and a fresh plan is created. This cannot be undone.',
      confirmLabel: 'Reset everything',
      danger: true
    });

    if (confirmed) {
      resetAllData();
    }
  });

  appElements.exportBtn.addEventListener('click', () => {
    printReport();
  });

  appElements.shareBtn.addEventListener('click', copySummary);

  if (appElements.gradingSystemPicker) {
    appElements.gradingSystemPicker.addEventListener('change', async () => {
      const selected = appElements.gradingSystemPicker.value;
      const result = await applyGradingSystem(selected);

      if (result === 'applied') {
        showToast(`Grading system set to ${gradingSystems[selected].name}.`, 'success');
      } else if (result === 'rejected') {
        showToast('Unable to change grading system.', 'error');
      }
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
  if (!('serviceWorker' in navigator)) {
    return;
  }

  /*
   * A service worker needs an http(s) origin. The Electron wrapper opens the
   * app from the file system, where the Cache API refuses to store the local
   * files and the worker cannot claim its clients. Registering there produced
   * unhandled promise rejections in the renderer, so the worker is simply not
   * registered outside a real origin.
   */
  if (window.location && window.location.protocol === 'file:') {
    console.info('Service worker registration is skipped: the app is not served over http(s).');
    return;
  }

  const swUrl = 'sw.js?v=10';

  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            if (!sessionStorage.getItem('sgpaCgpaReloadedForSwUpdate')) {
              sessionStorage.setItem('sgpaCgpaReloadedForSwUpdate', 'true');
              window.location.reload();
            }
          }
        });
      });
    })
    .catch((error) => {
      // Registration failures are reported, but never break the app: the
      // calculator keeps working without offline caching.
      console.warn('The service worker could not be registered', error);
    });
}

function initializeApp() {
  applyTheme(appState.theme);

  if (appElements.gradingSystemPicker && gradingSystems[appState.selectedGradingSystem]) {
    appElements.gradingSystemPicker.value = appState.selectedGradingSystem;
  }

  setupEventListeners();
  renderSemesters();

  if (stateRecoveryNotice) {
    try {
      saveState();
    } catch (error) {
      console.warn('Could not persist repaired state', error);
    }
    showToast(stateRecoveryNotice, 'warn');
  }

  registerServiceWorker();
}

initializeApp();
