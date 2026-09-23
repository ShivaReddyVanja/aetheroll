/**
 * @format
 */

import 'node-libs-react-native/globals';
import { AppRegistry } from 'react-native';

// Polyfill global.crypto.getRandomValues for GramJS / crypto-browserify in React Native
if (typeof global.crypto !== 'object') {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = function getRandomValues(array) {
    if (!array || !array.length) return array;
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}

// Polyfill window.addEventListener for GramJS PromisedWebSockets
if (typeof window !== 'undefined') {
  if (typeof window.addEventListener !== 'function') {
    window.addEventListener = () => {};
  }
  if (typeof window.removeEventListener !== 'function') {
    window.removeEventListener = () => {};
  }
}
if (typeof global.addEventListener !== 'function') {
  global.addEventListener = () => {};
}
if (typeof global.removeEventListener !== 'function') {
  global.removeEventListener = () => {};
}

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
