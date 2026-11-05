const {installExtension,runInstaller}=require('../electron/extension-setup.cjs');

if(require.main===module)runInstaller();
module.exports={installExtension};
