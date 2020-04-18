const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const sftpClient = require('ssh2-sftp-client');
const { Readable, Transform } = require('stream');
const path = require('path');
const micromatch = require('micromatch');

(async () => {
  let client = null;
  let connected = false;

  try {
    const host = core.getInput('host');
    const port = core.getInput('port');
    const user = core.getInput('user');
    const password = core.getInput('password');
    const privateKey = core.getInput('private_key');
    const localPath = core.getInput('local_path');
    const remotePath = (core.getInput('remote_path') || '').trim('/');
    const ignore = (core.getInput('ignore') || '').split(',').filter(Boolean);
    const payload = github.context.payload;
  
    const config = {
      host: host,
      username: user,
      password: password,
      port: port || 22,
      privateKey: privateKey
    };
    
    client = new sftpClient;
    await client.connect(config);
    connected = true;

    let start = '';

    if (await client.exists(remotePath + '/.revision')) {
      const st = new Transform();
      st._transform = function (chunk,encoding,done)  {
        this.push(chunk)
        done();
      };

      await client.get(remotePath + '/.revision', st);
      const remoteHash = new Promise((resolve, reject) => {
        st.on('end', resolve(st.read()));
        st.on('error', reject)
      });
      start = await remoteHash;
      // try { start = (await git('rev-parse', '--verify', `${await remoteHash}^{commit}`)).trim(); } catch(e) {};
    }

    console.log('Remote Revision:', start.toString());

    const end = payload.after;
    
    if (start == '') {
      console.log('Remote revision empty, get from initial commit');
      start = (await git('hash-object', '-t', 'tree', '/dev/null')).trim();
    }
    
    console.log('Comparing', `${start}..${end}`);

    const modified = await git('diff', '--name-only', '--diff-filter=AM', start, end);
    const renamed = await git('diff', '--name-only', '--diff-filter=R', start, end);
    const deleted = await git('diff-tree', '--name-only', '--diff-filter=D', '-t', start, end);
  
    const filterFile = file => {
      if (file === '') return false;
      if (['', './', '.'].indexOf(localPath) !== -1 && !file.startsWith(localPath)) return false;
      if (ignore.length && micromatch.isMatch(file, ignore)) return false;
      return true;
    }

    const filteredModified = modified.split("\n").filter(filterFile);
    const fileteredRenamed = renamed.split("\n").filter(filterFile);
    const filteredDeleted = deleted.split("\n").filter(filterFile);
  
    if (filteredModified.length === 0 && fileteredRenamed.length === 0 && filteredDeleted.length === 0) {
      console.log('No Changes');
    }
    else {
      for (let i = 0; i < filteredDeleted.length; i++) {
        const file = filteredDeleted[i];
        const remoteFile = remotePath + '/' + file;
        const checkRemoteFile = await client.exists(remoteFile);

        if ( ! checkRemoteFile) continue;
        
        if (checkRemoteFile == 'd') {
          await client.rmdir(remoteFile, true);
        }
        else {
          await client.delete(remoteFile);
        }
        console.log('Deleted: ' + file);
      } 

      for (let i = 0; i < filteredModified.length; i++) {
        const file = filteredModified[i];
        const remoteFile = remotePath + '/' + file;
        const remoteFilePath = path.dirname(remoteFile);
        const checkRemoteFilePath = await client.exists(remoteFilePath);
        
        if (checkRemoteFilePath != 'd') {
          if (checkRemoteFilePath) {
            await client.delete(remoteFilePath);
          }

          await client.mkdir(remoteFilePath, true);
        }

        await client.fastPut(file, remoteFile);
        console.log('Uploaded: ' + file);
      }
    
      for (let i = 0; i < fileteredRenamed.length; i++) {
        const file = fileteredRenamed[i];
        await client.rename(remotePath + '/' + file, remotePath + '/' + file);
        console.log('Renamed: ' + file);
      }
    }
  
    await client.put(Readable.from(end), remotePath + '/.revision', { mode: 0o644 });
    client.end();
  } catch(e) {
    core.setFailed(e.message);
    if (client && connected) client.end();
  }
  
  function git() {
    return new Promise(async (resolve, reject) => {
      try {
        let output = '';
        let error = '';

        await exec.exec('git', Array.from(arguments), {
          listeners: {
            stdout: (data) => {
              output += data.toString();
            },
            stderr: (data) => {
              error += data.toString();
            }
          },
          silent: false
        });

        if (error.length) {
          return reject(error);
        }

        resolve(output);
      } catch (e) {
        reject(e);
      }
    });
  }
})();
