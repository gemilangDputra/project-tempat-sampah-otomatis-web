#include <Servo.h>

Servo motorTutup;

// Pin sensor ultrasonik
const int trigPin = 9;
const int echoPin = 10;

// Pin motor servo
const int servoPin = 6;

// Pengaturan tempat sampah
const int jarakBuka = 20;       // Jarak deteksi 20 cm
const int posisiTutup = 0;      // Sudut tutup tertutup
const int posisiBuka = 100;     // Sudut tutup terbuka

long durasi;
int jarak;

void setup() {
  Serial.begin(9600);

  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  motorTutup.attach(servoPin);
  motorTutup.write(posisiTutup);

  Serial.println("Tempat Sampah Otomatis Aktif");
}

int bacaJarak() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  durasi = pulseIn(echoPin, HIGH, 30000);

  if (durasi == 0) {
    return 999;
  }

  return durasi * 0.0343 / 2;
}

void loop() {
  jarak = bacaJarak();

  Serial.print("Jarak benda: ");
  Serial.print(jarak);
  Serial.println(" cm");

  if (jarak > 0 && jarak <= jarakBuka) {
    motorTutup.write(posisiBuka);
    Serial.println("Tutup terbuka");

    // Menunggu sampai benda menjauh
    unsigned long waktuMulai = millis();

    while (millis() - waktuMulai < 3000) {
      int jarakBaru = bacaJarak();

      if (jarakBaru <= jarakBuka) {
        waktuMulai = millis();
      }

      delay(100);
    }

    motorTutup.write(posisiTutup);
    Serial.println("Tutup tertutup");

    delay(500);
  }

  delay(100);
}