exports.version = 0.2
exports.description = "Get notifications about uploads and new connections (configurable)"
exports.apiRequired = 12.3
exports.preview = ["https://github.com/user-attachments/assets/1601cf66-ce05-4b84-b9e8-54f490f7628d"]
exports.config = {
    uploads: { type: 'boolean', defaultValue: true, label: "Notify on uploads" },
    newIp: { type: 'select', options: { never: false, "every hour": 1, "every day": 24, "every month": 30*24 }, defaultValue: false, label: "Notify on connection from new IP" },
}

exports.init = api => {
    const { exec } = api.require('child_process')
    const { cmdEscape, bashEscape } = api.require('./util-os')
    const { platform } = process
    const exe = api.require('path').join(__dirname, 'notify-send.exe') // https://vaskovsky.net/notify-send/
    const seen = new Set()
    api.events.on('uploadFinished', ({ ctx }) =>
        api.getConfig('uploads') && notify(`Uploaded: ${ctx.state.uploadDestinationPath}`))
    api.events.on('newSocket', ({ ip }) => {
        const hours = api.getConfig('newIp')
        if (!hours || seen.has(ip)) return
        seen.add(ip)
        api.setTimeout(() => seen.delete(ip), hours * 3600_000) // reset
        notify(`New connection from ${ip}`)
    })

    return {
        customApi: { notify }
    }

    function notify(message, title='HFS') {
        api.log(message)
        const cmd = platform === 'win32' ? `${cmdEscape(exe)} ${cmdEscape(title)} ${cmdEscape(message)}`
            : platform === 'darwin' ? `osascript -e 'display notification ${cmdEscape(message)} with title ${cmdEscape(title)}'`
            : `notify-send ${bashEscape(title)} ${bashEscape(message)}`
        exec(cmd, (err, stdout, stderr) => {
            if (err || stderr)
                return api.log(String(err || stderr))
        })
    }
}
