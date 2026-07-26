#!/bin/sh
set -e
: "${MINECRAFT_API_PORT:=8000}"
: "${MINECRAFT_WEB_INTERNAL_PORT:=80}"
cat > /etc/nginx/conf.d/default.conf << EOF
server {
    listen ${MINECRAFT_WEB_INTERNAL_PORT};
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location /api/ {
    client_max_body_size 2G;
        proxy_pass http://${BACKEND_HOST:-minecraft-api}:${MINECRAFT_API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
exec nginx -g 'daemon off;'
