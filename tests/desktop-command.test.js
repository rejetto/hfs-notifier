const assert = require('node:assert/strict')
const test = require('node:test')

test('desktop notifications pass untrusted text as arguments', async () => {
    let event
    let invocation
    const plugin = require('../dist/plugin.js')
    const api = {
        require(id) {
            if (id === 'child_process') return { execFile(command, args, cb) {
                invocation = { command, args }
                cb()
            } }
            if (id === 'path') return require('node:path')
            throw Error(id)
        },
        subscribeConfig() {},
        events: { on(name, cb) { if (name === 'uploadFinished') event = cb } },
        getConfig(key) { return { uploads: true, desktopEnabled: true }[key] },
        setTimeout(cb) { cb(); return 1 },
        setError() {},
        log() {},
    }
    plugin.init(api)
    event({ ctx: { state: { uploadDestinationPath: "x'; touch /tmp/pwned; '" } } })
    await new Promise(setImmediate)

    assert.equal(invocation.command, process.platform === 'win32' ? require('node:path').join(__dirname, '../dist/notify-send.exe')
        : process.platform === 'darwin' ? 'osascript' : 'notify-send')
    assert.equal(invocation.args.at(-1), "Uploaded: x'; touch /tmp/pwned; '")
})
