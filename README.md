# Fast SFTP Deploy

Upload only changes to SFTP Server

It will check if the remote path has `.revision`, will download and compare the hash from that file with the new commit hash, then upload the changes to remote server, and update the `.revision` in the remote server. If there is no `.revision` it will compare and upload from the initial commit

## Inputs

### `host`

**Required** Hostname or ip address sftp server

### `port`

Port number sftp server. Default `22`

### `user`

**Required** Username to login sftp server

### `password`

Password to login sftp server

### `privateKey`

SSH private key to login sftp server, if you want to connect without password, you can save your private key in your repo settings -> secrets

### `localPath`

Root local directory to deploy, default is your root project

### `remotePath`

**Required** Root remote directory sftp server, default is depend your default home user

### `ignore`

Ignore files, support glob wildcard, separated by comma each pattern. default: `.github/**,.gitignore,**/.gitignore`

### `remote_revision`

Remote revision hash


## Action Example

### Simple Action

```
on:
  push:
    branches: [ master ]

jobs:
  deploy_job:
    runs-on: ubuntu-latest
    name: deploy
    steps:
      - name: checkout
        uses: actions/checkout@v2
        with:
          fetch-depth: 0
      - name: deploy file
        uses:  swznd/sftp-deploy@master
        with:
          host: ${{ secrets.IP_PROD_SERVER }}
          user: username
          private_key: ${{ secrets.SSH_PRIVATE_KEY }}
          remote_path: /home/username/app
          ignore: .github/**
```

### Fast Action

It will fetch and checkout only the changes, the `.revision` file need can be accessed via web

```
on:
  push:
    branches: [ master ]

env:
  TOTAL_COMMITS: "0"
  
jobs:
  deploy:
    runs-on: ubuntu-latest
    name: deploy
    steps:
      # fetch revision
      - id: fetch_revision
        name: fetch revision
        run: echo ::set-output name=revision::$(curl -m 15 https://example.com/.revision)
      
      # check how much commits ahead via github API
      - id: get_total_commit_ahead
        name: fetch total commits count
        uses: octokit/request-action@v2.x
        if: steps.fetch_revision.outputs.revision != ''
        with:
          route: GET /repos/:repository/compare/:base...:head
          repository: ${{ github.repository }}
          base: ${{ steps.fetch_revision.outputs.revision }}
          head: ${{ github.sha }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - id: parse_total_commit_ahead
        uses: gr2m/get-json-paths-action@v1.x
        if: steps.fetch_revision.outputs.revision != ''
        with:
          json: ${{ steps.get_total_commit_ahead.outputs.data }}
          total_commits: "total_commits"

      # update TOTAL_COMMIT variable
      - name: set total_commit
        if: steps.parse_total_commit_ahead.outputs.total_commits != ''
        run: "echo ::set-env name=TOTAL_COMMITS::$(( ${{ steps.parse_total_commit_ahead.outputs.total_commits }} + 1 ))" # add one commit back, so it can compare from remote revision

      - name: checkout
        uses: actions/checkout@v2
        with:
          fetch-depth: ${{ env.TOTAL_COMMITS }} # fetch with total commit

      - name: deploy
        uses:  swznd/sftp-deploy@master
        with:
          host: ${{ secrets.IP_PROD_SERVER }}
          user: username
          private_key: ${{ secrets.SSH_PRIVATE_KEY }}
          remote_path: /home/username/app
```

## Other Deployment Actions

FTP Deployment: https://github.com/swznd/ftp-deploy/