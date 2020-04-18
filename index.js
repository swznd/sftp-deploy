const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const sftpClient = require('ssh2-sftp-client');
const { Readable, Transform } = require('stream');

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
    const ignore = (core.getInput('ignore') || '').split(',');
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
    const deleted = await git('diff', '--name-only', '--diff-filter=D', start, end);
  
    const filterFile = file => ['', './', '.'].indexOf(localPath) !== -1 || file.startsWith(localPath) || (ignore && micromatch.isMatch(file, ignorePattern));

    const filteredModified = modified.split("\n").filter(filterFile);
    const fileteredRenamed = renamed.split("\n").filter(filterFile);
    const filteredDeleted = deleted.split("\n").filter(filterFile);
  
    if (filteredModified.length === 0 && fileteredRenamed.length === 0 && filteredDeleted.length === 0) {
      console.log('No Changes');
      process.exit();
    }
  
    for (let i = 0; i < filteredModified.length; i++) {
      const file = filteredModified[i];
      await client.fastPut(file, remotePath + '/' + file);
      console.log('Uploaded: ' + file);
    }
  
    for (let i = 0; i < fileteredRenamed.length; i++) {
      const file = fileteredRenamed[i];
      await client.rename(remotePath + '/' + file, remotePath + '/' + file);
      console.log('Renamed: ' + file);
    }
  
    for (let i = 0; i < filteredDeleted.length; i++) {
      const file = filteredDeleted[i];
      await client.delete(remotePath + '/' + file);
      console.log('Deleted: ' + file);
    }
  
    // console.log('modified', modified, 'deleted', deleted, 'renamed', renamed);
  
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
