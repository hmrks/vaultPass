/* eslint-disable no-console */
/* eslint-disable no-unused-vars */
/* global browser chrome */

function storePathComponents(storePath) {
  let path = 'secret/vaultPass';
  if (storePath && storePath.length > 0) {
    path = storePath;
  }
  const pathComponents = path.split('/');
  const storeRoot = pathComponents[0];
  const storeSubPath =
    pathComponents.length > 0 ? pathComponents.slice(1).join('/') : '';

  return {
    root: storeRoot,
    subPath: storeSubPath,
  };
}

if (!browser.browserAction) {
  browser.browserAction = chrome.browserAction ?? chrome.action;
}

/**
 * Make a call to vault api.
 * @param string method GET or POST or LIST etc.
 * @param midpath The middle of the vault path. Basically "metadata" or "data".
 * @param path The suffix of the path to query from vault.
 * @param string error if set, will error this if not ok.
 * @param dict body if set, will add it to POST it
 */
async function vaultApiCall(
  method,
  midpath,
  path = '',
  error = '',
  body = undefined
) {
  const vaultToken = (await browser.storage.local.get('vaultToken')).vaultToken;
  const vaultServerAddress = (await browser.storage.sync.get('vaultAddress'))
    .vaultAddress;
  const storePath = (await browser.storage.sync.get('storePath')).storePath;
  const storeComponents = storePathComponents(storePath);
  if (path) {
    // make sure path has leading slash.
    path = '/' + path.replace(/^\/*/, '');
  }
  const url = `${vaultServerAddress}/v1/${storeComponents.root}/${midpath}/${storeComponents.subPath}${path}`;
  const res = await fetch(url, {
    method: method,
    headers: {
      'X-Vault-Token': vaultToken,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (error && (!res.ok || res.status != 200)) {
    const apiResponse = await res.json();
    let msg = `ERROR: ${error}. Calling ${url} failed with status=${
      res.status
    }.`;
    if (apiResponse.errors) {
      msg += ` ${apiResponse.errors}`;
    } else if (apiResponse.warnings) {
      msg += ` ${apiResponse.warnings}`;
    }
    throw new Error(msg);
  }
  return res;
}

async function querySecretsCallback(searchString, secret) {
  const secretsInPath = await vaultApiCall('LIST', 'metadata', `${secret}`);
  if (!secretsInPath.ok) {
    if (secretsInPath.status !== 404) {
      notify.error(`Unable to read ${secret}... Try re-login`, {
        removeOption: true,
      });
    }
    return { element: null, credentialsSets: null };
  }

  const keys = (await secretsInPath.json()).data.keys;
  for (const element of keys) {
    if (element === searchString) {
      const credentials = await getCredentials(`${secret}${element}`);
      const credentialsSets = extractCredentialsSets(credentials.data.data);
      notify.clear();
      return { element, credentialsSets };
    }
  }

  return { element: null, credentialsSets: null };
}

async function getCredentials(urlPath) {
  const result = await vaultApiCall(
    'GET',
    'data',
    urlPath,
    'getting credentials'
  );
  return await result.json();
}

function extractCredentialsSets(data) {
  const keys = Object.keys(data);
  const credentials = [];

  for (const key of keys) {
    if (key.startsWith('username')) {
      const passwordField = 'password' + key.substring(8);
      if (data[passwordField]) {
        credentials.push({
          username: data[key],
          password: data['password' + key.substring(8)],
          title: data.hasOwnProperty('title' + key.substring(8))
            ? data['title' + key.substring(8)]
            : data.hasOwnProperty('title')
              ? data['title']
              : '',
          comment: data.hasOwnProperty('comment' + key.substring(8))
            ? data['comment' + key.substring(8)]
            : data.hasOwnProperty('comment')
              ? data['comment']
              : '',
        });
      }
    }
  }

  return credentials;
}

function clearHostname(hostname) {
  const match = hostname.match(/^(www\.)?(.*)$/);

  return match[2] ? match[2] : match[1];
}
