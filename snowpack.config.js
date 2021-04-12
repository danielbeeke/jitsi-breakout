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
    'port': 8080
  },
  'buildOptions': {
    'out': 'docs'
  },
  "routes": [
    { "match": "routes", "src": ".*", "dest": "/404.html" },
  ],
  'plugins': [
    [
      '@snowpack/plugin-sass',
    ]
  ]
}
