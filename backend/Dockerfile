FROM eclipse-temurin:21-jdk-alpine AS build
RUN apk add --no-cache maven gcc musl-dev make
WORKDIR /work
COPY native-audit/ native-audit/
RUN make -C native-audit
COPY backend/pom.xml backend/pom.xml
RUN cd backend && mvn -B dependency:go-offline
COPY backend/src/ backend/src/
RUN cd backend && mvn -B test package
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S wallet && adduser -S wallet -G wallet
WORKDIR /app
COPY --from=build /work/backend/target/confidencewallet.jar /app/app.jar
COPY --from=build /work/native-audit/libledger_audit.so /app/libledger_audit.so
USER wallet
ENV PORT=8080
EXPOSE 8080
CMD ["java","--enable-preview","--enable-native-access=ALL-UNNAMED","-jar","/app/app.jar"]
