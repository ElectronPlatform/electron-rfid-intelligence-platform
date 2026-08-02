'use strict';

const {execFileSync}=require('child_process');
const path=require('path');

exports.default=async function afterPackLocalMac(context){
  if(process.env.ELECTRON_LOCAL_ADHOC_SIGN!=='1' || context.electronPlatformName!=='darwin') return;
  const appName=`${context.packager.appInfo.productFilename}.app`;
  const appPath=path.join(context.appOutDir,appName);
  console.log(`  • local ad-hoc signing  app=${appPath}`);
  execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',appPath],{stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',appPath],{stdio:'inherit'});
};
