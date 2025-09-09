// ecosystem.config.js
module.exports = {
    apps: [
      {
        name: "mural-server",
        script: "server.js",
        cwd: __dirname,                  // diretório do projeto
        instances: 1,                    // pode usar "max" se quiser 1 por CPU (não é necessário aqui)
        autorestart: true,
        watch: false,                    // NÃO assistir arquivos (evita restart em upload de mídia)
        max_memory_restart: "512M",
        time: true,                      // timestamps nos logs
        out_file: "./logs/out.log",
        error_file: "./logs/err.log",
        env: {
          NODE_ENV: "production",
          PORT: "3001",
          // Deixe "true" se quiser redirecionar 80->3001 pelo seu server.js:
          REDIRECT_80: "true",
          // (Opcional) defina uma secret estável para a sessão:
          // SESSION_SECRET: "troque-por-uma-string-aleatoria"
        }
      }
    ]
  };
  