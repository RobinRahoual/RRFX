/* Ce qu'il faut pour compiler un DCTL de DaVinci Resolve en C ordinaire (tests). */
#include <math.h>
#include <stdio.h>
typedef struct { float x, y, z; } float3;
static float3 make_float3(float a, float b, float c) { float3 r = { a, b, c }; return r; }
#define __DEVICE__ static
#define __CONSTANT__ static const
#define __CONSTANTREF__ const
#define _powf powf
#define _fabs fabsf
#define _fmaxf fmaxf
#define _fminf fminf
#define _floorf floorf
#define _cosf cosf
#define _sinf sinf
#define _sqrtf sqrtf
#define DEFINE_UI_PARAMS(name, label, type, def, mn, mx, step) static float name = (def);
