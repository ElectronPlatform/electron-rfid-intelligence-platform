/*
 * Connection Compatibility Engine read-only IPC boundary.
 *
 * Task 6 deliberately exposes only structured connection and compatibility results. It does not
 * expose PM3 transport, raw command output, lifecycle mutation or renderer UI.
 */
'use strict';

const CHANNELS=Object.freeze({
  requestSnapshot:'connection-compatibility:request-snapshot',
  getLastSnapshot:'connection-compatibility:get-last-snapshot',
  describe:'connection-compatibility:describe'
});

function registerConnectionCompatibilityIpc({ipcMain,getService}={}){
  if(!ipcMain||typeof ipcMain.handle!=='function'){
    throw new TypeError('Electron ipcMain is required for the connection compatibility IPC boundary.');
  }
  if(typeof getService!=='function'){
    throw new TypeError('A connection compatibility service resolver is required.');
  }

  ipcMain.handle(CHANNELS.requestSnapshot,async(_event,input={})=>{
    return getService().requestSnapshot(input);
  });
  ipcMain.handle(CHANNELS.getLastSnapshot,async(_event,options={})=>{
    return getService().getLastSnapshot(options);
  });
  ipcMain.handle(CHANNELS.describe,async()=>{
    return getService().describe();
  });

  return Object.freeze({
    channels:CHANNELS,
    readOnly:true
  });
}

module.exports={
  CHANNELS,
  registerConnectionCompatibilityIpc
};
