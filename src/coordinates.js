const common = require('./common');
const clone = require('lodash/clone');

module.exports = class Coordinates {
  static polygonCenter(polygon) {
    const points = clone(polygon);

    points.sort((a, b) => a[1] - b[1]);
    // Get center y
    const cy = (points[0][1] + points[points.length - 1][1]) / 2;

    // Sort from right to left
    points.sort((a, b) => b[0] - a[0]);

    // Get center x
    const cx = (points[0][0] + points[points.length - 1][0]) / 2;

    // Center point
    return [cx, cy];
  }
};
