exports.version = 0.3
exports.description = "Get notifications about uploads and new connections (configurable)"
exports.apiRequired = 12.3
exports.preview = ["https://github.com/user-attachments/assets/d57fbf30-cad1-4b1f-b385-3e898d352774"]
exports.changelog = [
    { "version": 0.3, "message": "Email notifications" }
]
const size = { xs: 6, sm: 4 }
const emailOnly = { ...size, showIf: v => v.emailEnabled }
exports.config = {
    uploads: { type: 'boolean', ...size, defaultValue: true, label: "Notify on uploads" },
    newIp: { type: 'select', ...size, options: { never: false, "every hour": 1, "every day": 24, "every month": 30*24 }, defaultValue: false, label: "Notify on connection from new IP" },
    desktopEnabled: { type: 'boolean', ...size, defaultValue: true, label: "Desktop notifications" },
    emailEnabled: { type: 'boolean', ...size, defaultValue: false, label: "Email notifications" },
    smtpHost: { defaultValue: '', label: "SMTP host", ...emailOnly, required: true },
    smtpPort: { type: 'number', defaultValue: 587, label: "SMTP port", min: 1, ...emailOnly },
    smtpSecure: { type: 'boolean', defaultValue: false, label: "Use TLS/SSL", ...emailOnly },
    smtpUser: { defaultValue: '', label: "SMTP username", ...emailOnly },
    smtpPassword: { defaultValue: '', label: "SMTP password", inputProps: { type: 'password' }, ...emailOnly },
    emailFrom: { defaultValue: '', label: "From address", ...emailOnly, required: true },
    emailTo: { defaultValue: '', label: "Recipients", multiline: true, ...emailOnly, required: true, helperText: "One address on each line" },
    emailSubjectPrefix: { defaultValue: "HFS", label: "Email subject prefix", ...emailOnly },
    emailBatchSeconds: { type: 'number', defaultValue: 30, min: 1, label: "Email batch seconds", ...emailOnly, helperText: "Collect notifications and send one email" },
}
exports.configDialog = { maxWidth: 'md' }

exports.init = api => {
    const nodemailer = require('./nodemailer.bundle')
    const { exec } = api.require('child_process')
    const { cmdEscape, bashEscape } = api.require('./util-os')
    const { platform } = process
    const exe = api.require('path').join(__dirname, 'notify-send.exe') // https://vaskovsky.net/notify-send/
    const pending = { desktop: [], email: [] }
    const timers = { desktop: 0, email: 0 }
    const seen = new Set()
    let emailProblem = ''

    api.subscribeConfig(['emailEnabled', 'smtpUser', 'smtpPassword'], values => {
        emailProblem = !values.emailEnabled ? ''
            // SMTP auth is all-or-nothing: half-filled credentials usually fail later with a less useful transport error
            : Boolean(values.smtpUser) !== Boolean(values.smtpPassword) ? "smtpUser and smtpPassword must both be set"
                : ''
        api.setError(emailProblem)
        if (emailProblem)
            api.log(`email notifications disabled: ${emailProblem}`)
    })

    api.events.on('uploadFinished', ({ ctx }) =>
        api.getConfig('uploads') && notify(`Uploaded: ${ctx.state.uploadDestinationPath}`, { title: 'Upload' }))
    api.events.on('newSocket', ({ ip }) => {
        const hours = api.getConfig('newIp')
        if (!hours || seen.has(ip)) return
        // we only want one alert per IP inside the configured window, regardless of channel
        seen.add(ip)
        api.setTimeout(() => seen.delete(ip), hours * 3600_000) // reset
        notify(`New connection from ${ip}`, { title: 'New connection' })
    })

    return {
        customApi: { notify }
    }

    async function notify(message, options) {
        if (typeof options === 'string')
            options = { title: options }
        api.log(message)
        const channels = getChannels(options)
        channels.forEach(channel =>
            enqueue(channel, { message, title: options?.title || 'HFS' }))
    }

    function getChannels(options) {
        const requested = options?.channels?.filter(x => x === 'desktop' || x === 'email')
        if (requested?.length)
            return [...new Set(requested)]
        return [
            api.getConfig('desktopEnabled') && 'desktop',
            api.getConfig('emailEnabled') && 'email',
        ].filter(Boolean)
    }

    function enqueue(channel, entry) {
        pending[channel].push(entry)
        if (timers[channel])
            return
        // batching is timer-based so bursts collapse into one notification without delaying forever under load
        const ms = channel === 'desktop' ? 2_000 : Number(api.getConfig('emailBatchSeconds')) * 1000
        timers[channel] = api.setTimeout(() => flush(channel), ms)
    }

    function flush(channel) {
        timers[channel] = 0
        const entries = pending[channel]
        pending[channel] = []
        if (!entries.length)
            return
        const msg = entries.length === 1 ? entries[0].message
            : entries.map((x, i) => `${i + 1}. ${x.message}`).join('\n')
        if (channel === 'desktop')
            sendDesktop(msg, 'HFS')
        else // grouped emails need a neutral subject because a mixed batch may contain different event types
            sendEmail(msg, entries.length === 1 ? entries[0].title : `${entries.length} notifications`)
    }

    function sendDesktop(message, title) {
        return new Promise(resolve => {
            const cmd = platform === 'win32' ? `${cmdEscape(exe)} ${cmdEscape(title)} ${cmdEscape(message)}`
                : platform === 'darwin' ? `osascript -e 'display notification ${cmdEscape(message)} with title ${cmdEscape(title)}'`
                : `notify-send ${bashEscape(title)} ${bashEscape(message)}`
            exec(cmd, (err, stdout, stderr) => {
                if (err || stderr)
                    api.log(String(err || stderr))
                resolve()
            })
        })
    }

    async function sendEmail(message, title) {
        const values = api.getConfig()
        if (!values.emailEnabled || emailProblem)
            return
        await nodemailer.createTransport({
            host: values.smtpHost,
            port: Number(values.smtpPort),
            secure: Boolean(values.smtpSecure),
            auth: values.smtpUser || values.smtpPassword ? {
                user: values.smtpUser,
                pass: values.smtpPassword,
            } : undefined,
        }).sendMail({
            from: values.emailFrom,
            to: values.emailTo.split(/ *[\n,]+ */).filter(Boolean),
            subject: `${values.emailSubjectPrefix}: ${title}`,
            text: message,
        }).catch(err =>
            api.log(`email notification failed: ${err?.message || err}`))
    }
}
