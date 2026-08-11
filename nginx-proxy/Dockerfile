FROM nginx:alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
RUN rm -f /var/log/nginx/access.log /var/log/nginx/error.log
EXPOSE 80