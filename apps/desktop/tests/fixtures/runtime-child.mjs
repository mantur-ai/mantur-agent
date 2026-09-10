process.once('SIGTERM', () => {
  setTimeout(() => { process.exit(0) }, 25)
})

process.on('message', (message) => {
  if (message?.type === 'desktop-test/ping') process.send({ type: 'desktop-test/pong' })
})

if (process.env.DESKTOP_TEST_SKIP_READY !== '1') {
  console.log('dsh web: http://127.0.0.1:4312/?token=desktop-test')
}
console.error('desktop runtime stderr')

setInterval(() => {}, 1_000)

process.on('message', (message) => {
  if (message?.type === 'desktop-test/update-ready') process.send({ type: 'mantur:update:ready' })
  if (message?.type === 'mantur:update:exit' && process.env.DESKTOP_TEST_IGNORE_UPDATE_EXIT !== '1') {
    console.log('desktop update final diagnostic')
    process.exit(Number(process.env.DESKTOP_TEST_UPDATE_EXIT_CODE ?? 0))
  }
})
