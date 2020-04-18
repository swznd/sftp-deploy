const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const sftpClient = require('ssh2-sftp-client');

(async () => {
  try {
    const host = core.getInput('host');
    const port = core.getInput('port');
    const user = core.getInput('user');
    const password = core.getInput('password');
    const privateKey = core.getInput('private_key');
    const localPath = core.getInput('local_path');
    const remotePath = (core.getInput('remote_path') || '').trim('/');
    const payload = github.context.payload;
  
    const config = {
      host: host,
      username: user,
      password: password,
      port: port || 22,
      privateKey: privateKey
    };
    
    const client = new sftpClient;
    await client.connect(config);
  
    let start = await client.fastGet(remotePath + '/.revision');
    const end = payload.before;
  
    if (start == '') {
      start = await git('hash-object', '-t', 'tree', '/dev/null');
    }
  
    const modified = await git('diff', '--name-only', '--diff-filter=AM', start, end);
    const renamed = await git('diff', '--name-only', '--diff-filter=R', start, end);
    const deleted = await git('diff', '--name-only', '--diff-filter=D', start, end);
  
    const filterFile = files => {
      files.filter(file => ['', './', '.'].indexOf(localPath) !== -1 || file.startsWith(localPath));
    }
  
    const filteredModified = modified.filter(filterFile);
    const fileteredRenamed = renamed.filer(filterFile);
    const filteredDeleted = deleted.filter(filterFile);
  
    if (filteredModified.length === 0 && fileteredRenamed.length === 0 && filteredDeleted.length === 0) {
      console.log('No Changes');
      process.exit();
    }
  
    // for (let i = 0; i < filteredModified.length; i++) {
    //   const file = filteredModified[i];
    //   await client.fastPut(file, remotePath + '/' + file);
    //   console.log('Uploaded: ' + file);
    // }
  
    // for (let i = 0; i < fileteredRenamed.length; i++) {
    //   const file = fileteredRenamed[i];
    //   await client.rename(remotePath + '/' + file, remotePath + '/' + file);
    //   console.log('Renamed: ' + file);
    // }
  
    // for (let i = 0; i < filteredDeleted.length; i++) {
    //   const file = filteredDeleted[i];
    //   await client.delete(remotePath + '/' + file);
    //   console.log('Deleted: ' + file);
    // }
  
    console.log('modified', modified, 'deleted', deleted, 'renamed', renamed);
  
    await client.put(end, remotePath + '/.revision');
  } catch(e) {
    core.setFailed(e.message);
  }
  
  function git() {
    return new Promise(async (resolve, reject) => {
      const options = {};
      options.listeners = {
        stdout: (data) => {
          resolve(data.toString())
        },
        stderr: (data) => {
          reject(data.toString())
        }
      };
      await exec.exec('git', arguments, options)
    });
  }
})();
