/* eslint-disable no-console */
/* global browser Notify storePathComponents */

const notify = new Notify(document.querySelector('#notify'));

// Timer used to delay querying Vault while the user is typing in the URL.
let urlInputTimer = null;
const debounceDelay = 1000; // delay in milliseconds

const formStateManager = {
  state: {
    mode: 'empty', // 'empty' || 'add' || 'overwrite' || 'disabled'
    dirty: false, // used to track if the user has modified the password
    credentialsLoaded: false, // used to track if whether data was fetched from Vault
  },

  isReadyToSubmit() {
    // Only ready if user made a change and either:
    // - they typed something new ('add')
    // - or modified an existing credential ('overwrite')
    return (
      this.state.dirty &&
      (this.state.mode === 'add' || this.state.mode === 'overwrite')
    );
  },

  invalidAttempt(reason = 'Please update the form before submitting') {
    notify.clear().error(reason, { time: 3000 });
    this.shakeButton();
  },

  shakeButton() {
    const { addButton } = getFields();
    addButton.classList.add('button--shake');
    setTimeout(() => addButton.classList.remove('button--shake'), 300);
  },

  setMode(mode) {
    if (mode === this.state.mode) return;
    this.state.mode = mode;

    const { addButton, loginBox, passBox, currentPassBox, currentPassLabel } =
      getFields();

    switch (mode) {
      case 'add':
        currentPassBox.value = '';
        currentPassLabel.classList.add('hidden');
        addButton.disabled = false;
        addButton.classList.remove('button--warning');
        addButton.classList.remove('button--disabled');
        addButton.classList.add('button--primary');
        addButton.innerText = 'Add';
        break;
      case 'overwrite':
        currentPassLabel.classList.remove('hidden');
        addButton.disabled = false;
        addButton.classList.remove('button--primary');
        addButton.classList.remove('button--disabled');
        addButton.classList.add('button--warning');
        addButton.innerText = 'Overwrite';
        break;
      case 'disabled':
        addButton.disabled = true;
        addButton.classList.remove('button--primary');
        addButton.classList.remove('button--warning');
        addButton.classList.add('button--disabled');
        addButton.innerText = 'Passwords match';
        break;
      case 'empty':
        currentPassBox.value = '';
        passBox.value = '';
        loginBox.value = '';
        currentPassLabel.classList.add('hidden');
        addButton.disabled = false;
        addButton.classList.remove('button--warning');
        addButton.classList.remove('button--disabled');
        addButton.classList.add('button--primary');
        addButton.innerText = 'Add';
        this.state.credentialsLoaded = false;
        this.state.dirty = false;
        break;
      default:
        notify.clear().error(`Unknown mode: ${mode}`);
        break;
    }
  },

  is(mode) {
    return this.state.mode === mode;
  },
};

function getFields() {
  return {
    addButton: document.getElementById('addButton'),
    showPasswordButton: document.getElementById('showPasswordButton'),
    generatePasswordButton: document.getElementById('generatePasswordButton'),
    loginBox: document.getElementById('loginBox'),
    passBox: document.getElementById('passBox'),
    currentPassBox: document.getElementById('currentPassBox'),
    currentPassLabel: document.getElementById('currentPassLabel'),
    urlBox: document.getElementById('urlBox'),
    dirSelect: document.getElementById('dirSelect'),
  };
}

function getValues() {
  const { dirSelect, loginBox, passBox, currentPassBox, urlBox } = getFields();
  return {
    activeSecret: dirSelect.value,
    username: loginBox.value,
    password: passBox.value,
    currentPassword: currentPassBox.value,
    url: urlBox.value,
  };
}

async function mainLoaded() {
  const [currentTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (currentTab.url) {
    currentTabId = currentTab.id;
    currentUrl = new URL(currentTab.url);
    currentHostname = clearHostname(currentUrl.hostname);
  } else {
    return notify.clear().error('No URL found');
  }

  const {
    addButton,
    showPasswordButton,
    generatePasswordButton,
    dirSelect,
    urlBox,
    passBox,
    currentPassBox,
  } = getFields();

  addButton.addEventListener('click', addButtonClick, false);
  showPasswordButton.addEventListener('click', showPasswordClick, false);
  generatePasswordButton.addEventListener(
    'click',
    generatePasswordClick,
    false
  );

  try {
    await populateDirectorySelection();
  } catch (err) {
    notify.clear().error(err.message);
    return;
  }

  if (dirSelect) {
    dirSelect.addEventListener('change', onDirectoryChange);
  }

  if (urlBox) {
    urlBox.addEventListener('input', onUrlChange, false);
    urlBox.value = currentHostname;
    urlBox.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (passBox) {
    passBox.addEventListener('input', onPasswordChange);
  }
  if (currentPassBox) {
    currentPassBox.addEventListener('input', onPasswordChange);
  }
}

async function populateDirectorySelection() {
  const fetchListOfSecretDirs = await vaultApiCall(
    'LIST',
    'metadata',
    '',
    'Fetching secrets directories'
  );

  let activeSecrets = (await browser.storage.sync.get('secrets')).secrets;
  if (!activeSecrets) {
    activeSecrets = [];
  }

  const availableSecrets = (await fetchListOfSecretDirs.json()).data.keys;
  activeSecrets = activeSecrets.filter(
    (secret) => availableSecrets.indexOf(secret) !== -1
  );

  const { dirSelect } = getFields();

  if (!dirSelect) return;

  activeSecrets.forEach((secret, index) => {
    const option = document.createElement('option');
    option.value = secret;
    option.text = secret;
    if (index == 0) {
      option.selected = true;
    }
    dirSelect.appendChild(option);
  });
}

function onDirectoryChange(event) {
  const { urlBox, loginBox, passBox } = getFields();

  const activeSecret = event.target.value;
  const currentUrl = urlBox.value;
  loginBox.disabled = true;
  passBox.disabled = true;
  onDataChange(activeSecret, currentUrl);
}

async function onDataChange(activeSecret, currentUrl) {
  const { urlBox, loginBox, passBox, currentPassBox, currentPassLabel } =
    getFields();

  try {
    const { element, credentialsSets } = await querySecretsCallback(
      currentUrl,
      activeSecret
    );

    if (credentialsSets) {
      const c = credentialsSets[0];
      urlBox.value = element;
      loginBox.value = c.username;
      currentPassBox.value = c.password;
      currentPassLabel.classList.remove('hidden');
      formStateManager.setMode('overwrite');
      formStateManager.state.credentialsLoaded = true;
      formStateManager.state.dirty = false;
    } else {
      formStateManager.state.credentialsLoaded = false;
      formStateManager.state.dirty = false;
      formStateManager.setMode('empty');
    }
  } catch (err) {
    notify.clear().error(err.message);
    return;
  } finally {
    loginBox.disabled = false;
    passBox.disabled = false;
  }
}

function onUrlChange() {
  const { urlBox, loginBox, passBox, dirSelect } = getFields();
  clearTimeout(urlInputTimer);
  urlInputTimer = setTimeout(() => {
    const urlValue = urlBox.value.trim();
    if (!urlValue) {
      formStateManager.setMode('empty');
      return;
    }
    // Disable username and password fields while checking
    // for existing credentials
    loginBox.disabled = true;
    passBox.disabled = true;
    const secretBase = dirSelect ? dirSelect.value : '';
    onDataChange(secretBase, urlValue);
  }, debounceDelay);
}

function onPasswordChange() {
  const { password, currentPassword } = getValues();

  const passwordsMatch = password === currentPassword;
  const hasPassword = password !== '';

  formStateManager.state.dirty = hasPassword && !passwordsMatch;

  if (!hasPassword) {
    const fallbackMode =
      formStateManager.is('overwrite') || formStateManager.is('disabled')
        ? 'overwrite'
        : 'add';
    formStateManager.setMode(fallbackMode);
    return;
  }

  if (!formStateManager.state.credentialsLoaded || !currentPassword) {
    formStateManager.setMode('add');
    return;
  }

  if (passwordsMatch) {
    formStateManager.setMode('disabled');
    return;
  }

  // Fallback to 'overwrite', passwords don't match, new password exists, credentials exist
  formStateManager.setMode('overwrite');
}

async function addButtonClick(event) {
  if (!formStateManager.isReadyToSubmit()) {
    formStateManager.invalidAttempt();
    return;
  }

  const { activeSecret, url, username, password } = getValues();

  try {
    new URL('https://' + url);
  } catch (err) {
    notify.clear().error('Please make sure the URL is valid');
    return;
  }

  if (url.includes('/')) {
    notify.error('Please make sure the URL does not contain slashes');
    return;
  }
  if (
    activeSecret.length == 0 ||
    url.length == 0 ||
    username.length == 0 ||
    password.length == 0
  ) {
    notify.error('Please make sure none of the fields are empty');
    return;
  }
  // get current value if exists
  const passPath = activeSecret + url;
  const getSecretResp = await vaultApiCall('GET', 'data', passPath, '');
  const getSecretJson = getSecretResp.ok ? await getSecretResp.json() : {};
  const data = getSecretResp.ok ? getSecretJson.data : {};
  const cas = getSecretResp.ok ? data.metadata.version : 0;
  const cur = getSecretResp.ok ? data.data : {};
  cur['username'] = username;
  cur['password'] = password;
  const updateSecretData = {
    data: cur,
    options: {
      cas: cas,
    },
  };
  const updateSecretJson = JSON.stringify(updateSecretData);
  const updateSecretResp = await vaultApiCall(
    'POST',
    'data',
    passPath,
    `could not update value with ${updateSecretJson}`,
    updateSecretData
  );

  switch (event.target.innerText.toLowerCase()) {
    case 'overwrite':
      notify.success(`Updated entry for ${url} in ${passPath}`, {
        time: 5000,
      });
      break;
    default:
      notify.success(`Added entry for ${url} in ${passPath}`, {
        time: 5000,
      });
      break;
  }

  formStateManager.setMode('empty');
}

function showPasswordClick() {
  const { currentPassBox, passBox } = getFields();

  if (currentPassBox.type === 'password') {
    currentPassBox.type = 'text';
  } else {
    currentPassBox.type = 'password';
  }

  if (passBox.type === 'password') {
    passBox.type = 'text';
  } else {
    passBox.type = 'password';
  }
}

function generatePasswordClick() {
  const { passBox } = getFields();

  try {
    if (!window.crypto || !window.crypto.getRandomValues) {
      throw new Error('Password generation is not supported in this browser.');
    }

    let allChars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-=_+[]{}|;:,.<>?/';
    let password = '';

    const passwordLength = 32;
    const allCharsLength = allChars.length;

    for (let i = 0; i < passwordLength; i++) {
      const randomIndex = Math.floor(
        (window.crypto.getRandomValues(new Uint32Array(1))[0] /
          (0xffffffff + 1)) *
          allCharsLength
      );
      password += allChars.charAt(randomIndex);
    }

    passBox.value = password;
    passBox.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    notify.clear().error(error.message);
  }
}

document.addEventListener('DOMContentLoaded', mainLoaded, false);
