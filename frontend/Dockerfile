FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css app.js schedule-utils.js /usr/share/nginx/html/
RUN sed -i '/^user /d; s|pid[[:space:]]*/var/run/nginx.pid;|pid /tmp/nginx.pid;|; s|pid[[:space:]]*/run/nginx.pid;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
    && chown -R nginx:nginx /usr/share/nginx/html \
    && chmod 644 /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
