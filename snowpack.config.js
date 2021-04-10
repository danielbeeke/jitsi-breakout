module.exports = {
  optimize: {
    bundle: true,
    target: 'es2018',
  },
  'mount': {
    'public': '/',
    'scss': '/css',
  },
  'devOptions': {
    'port': 8080,
  },
  'plugins': [
    [
      '@snowpack/plugin-sass',
    ]
  ]
}
