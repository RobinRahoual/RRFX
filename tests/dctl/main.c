/* Lit des triplets RVB sur l'entrée, écrit le résultat du DCTL. */
int main(void) {
  float r, g, b;
  while (scanf("%f %f %f", &r, &g, &b) == 3) {
    float3 o = transform(1920, 1080, 0, 0, r, g, b);
    printf("%.6f %.6f %.6f\n", o.x, o.y, o.z);
  }
  return 0;
}
