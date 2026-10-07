#include <cups/raster.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc == 7 && !strcmp(argv[1], "write")) {
    unsigned width = atoi(argv[3]), height = atoi(argv[4]), dpi = atoi(argv[5]), pages = atoi(argv[6]);
    cups_mode_t mode = !strcmp(argv[2], "pwg") ? CUPS_RASTER_WRITE_PWG : CUPS_RASTER_WRITE_APPLE;
    cups_raster_t *r = cupsRasterOpen(STDOUT_FILENO, mode);
    unsigned char *row = malloc(width);
    if (!r || !row || !width || !height || !dpi || !pages) return 2;
    for (unsigned p = 0; p < pages; p++) {
      cups_page_header2_t h = {0};
      h.HWResolution[0] = h.HWResolution[1] = dpi;
      h.PageSize[0] = 595; h.PageSize[1] = 841;
      h.ImagingBoundingBox[2] = 595; h.ImagingBoundingBox[3] = 841;
      h.cupsImagingBBox[2] = (width + 0.25f) * 72 / dpi;
      h.cupsImagingBBox[3] = (height + 0.25f) * 72 / dpi;
      h.cupsWidth = width; h.cupsHeight = height;
      h.cupsBitsPerColor = h.cupsBitsPerPixel = 8;
      h.cupsBytesPerLine = width; h.cupsColorSpace = CUPS_CSPACE_SW;
      h.cupsColorOrder = CUPS_ORDER_CHUNKED; h.cupsNumColors = 1;
      h.NumCopies = 1;
      h.cupsInteger[0] = pages; h.cupsInteger[1] = h.cupsInteger[2] = 1;
      strcpy(h.cupsPageSizeName, "iso_a4_210x297mm");
      if (!cupsRasterWriteHeader2(r, &h)) return 3;
      for (unsigned y = 0; y < height; y++) {
        if (fread(row, 1, width, stdin) != width || cupsRasterWritePixels(r, row, width) != width) return 4;
      }
    }
    cupsRasterClose(r); free(row);
    return fgetc(stdin) == EOF ? 0 : 5;
  }
  if (argc == 4 && !strcmp(argv[1], "read")) {
    int fd = open(argv[2], O_RDONLY);
    if (fd < 0) return 6;
    cups_raster_t *r = cupsRasterOpen(fd, CUPS_RASTER_READ);
    if (!r) return 7;
    cups_page_header2_t h;
    unsigned p = 0;
    printf("[");
    while (cupsRasterReadHeader2(r, &h)) {
      if (!h.cupsWidth || h.cupsWidth > 10000 || !h.cupsHeight || h.cupsHeight > 15000 || h.cupsBytesPerLine != h.cupsWidth) return 8;
      char path[4096];
      snprintf(path, sizeof(path), "%s-%u.raw", argv[3], p);
      FILE *f = fopen(path, "wb");
      unsigned char *row = malloc(h.cupsBytesPerLine);
      if (!f || !row) return 9;
      for (unsigned y = 0; y < h.cupsHeight; y++) {
        if (cupsRasterReadPixels(r, row, h.cupsBytesPerLine) != h.cupsBytesPerLine || fwrite(row, 1, h.cupsBytesPerLine, f) != h.cupsBytesPerLine) return 10;
      }
      if (fclose(f)) return 11;
      free(row);
      printf("%s{\"width\":%u,\"height\":%u,\"xResolution\":%u,\"yResolution\":%u,\"bits\":%u,\"colorSpace\":%u,\"colors\":%u,\"pages\":%u}", p ? "," : "", h.cupsWidth, h.cupsHeight, h.HWResolution[0], h.HWResolution[1], h.cupsBitsPerPixel, h.cupsColorSpace, h.cupsNumColors, h.cupsInteger[0]);
      p++;
    }
    printf("]\n");
    const char *error = cupsRasterErrorString();
    if (error && *error) { fprintf(stderr, "%s\n", error); return 12; }
    cupsRasterClose(r); close(fd);
    return p ? 0 : 13;
  }
  return 1;
}
