require('dotenv').config()
const express = require('express')

const app = express()

// The host assigns the port in production — never hardcode it.
// The fallback is only for local dev, if .env is missing.
const port = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.get('/twitter', (req, res) => {
  res.send('Welcome to Twitter')
})

app.get('/login', (req, res) => {
  res.send('<h1> Please login</h1>')
})

app.get('/youtube', (req, res) => {
  res.send('<h2>Chai aur Code</h2>')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
