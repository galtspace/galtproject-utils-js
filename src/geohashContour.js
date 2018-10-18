const ngeohash = require('ngeohash');
const _ = require('lodash');
const Geohash = require('./geohash');
const GeohashExtra = require('./geohashExtra');
const geojsonArea = require('@mapbox/geojson-area');
const overlayPslg = require('overlay-pslg');

module.exports = class GeohashContour {
    /**
     * Get area of geohashes contour in meters
     * @param contour
     * @returns [lat, lon]
     */
    static area(contour) {
        return Math.abs(geojsonArea.ring(contour.map((geohash) => {
            const coors = GeohashExtra.decodeToLatLon(geohash);
            return [coors.lat, coors.lon];
        })));
    }

    /**
     * Sort geohashes of contour in clockwise direction
     * @param contour
     * @param antiClockwise
     * @returns {*}
     */
    static sortClockwise(contour, antiClockwise = false) {
        if(!contour.length || contour.length === 1) {
            return contour;
        }
        let points = contour.map((geohash) => {
            const coors = GeohashExtra.decodeToLatLon(geohash);
            return {x: coors.lat, y: coors.lon};
        });

        // Find min max to get center
        // Sort from top to bottom
        points.sort((a, b) => a.y - b.y);

        // Get center y
        const cy = (points[0].y + points[points.length - 1].y) / 2;

        // Sort from right to left
        points.sort((a, b) => b.x - a.x);

        // Get center x
        const cx = (points[0].x + points[points.length - 1].x) / 2;

        // Center point
        const center = {x: cx, y: cy};

        // Pre calculate the angles as it will be slow in the sort
        // As the points are sorted from right to left the first point
        // is the rightmost

        // Starting angle used to reference other angles
        let startAng;
        points.forEach(point => {
            let ang = Math.atan2(point.y - center.y, point.x - center.x);
            if (!startAng) {
                startAng = ang
            }
            else {
                if (ang < startAng) {  // ensure that all points are clockwise of the start point
                    ang += Math.PI * 2;
                }
            }
            point.angle = ang; // add the angle to the point
        });
        
        // Sort clockwise;
        points.sort((a, b) => a.angle - b.angle);
        
        if(antiClockwise) {
            const ccwPoints = points.reverse();

            // move the last point back to the start
            ccwPoints.unshift(ccwPoints.pop());
            points = ccwPoints;
        }
        
        return points.map((point) => {
            return GeohashExtra.encodeFromLatLng(point.x, point.y, contour[0].length);
        })
    }

    /**
     * Overlay operations with contours
     * @param redContour
     * @param blueContour
     * @param operation
     * @returns [geohash]
     */
    static overlay(redContour, blueContour, operation) {
        const redPoints = [], redEdges = [];
        const bluePoints = [], blueEdges = [];

        redContour.forEach((geohash, index) => {
            const coors = GeohashExtra.decodeToLatLon(geohash);
            redPoints.push([coors.lat, coors.lon]);
            redEdges.push([index, (redContour.length - 1 === index) ? 0 : index + 1]);
        });

        blueContour.forEach((geohash, index) => {
            const coors = GeohashExtra.decodeToLatLon(geohash);
            bluePoints.push([coors.lat, coors.lon]);
            blueEdges.push([index, (blueContour.length - 1 === index) ? 0 : index + 1]);
        });

        const overlayResult = overlayPslg(redPoints, redEdges, bluePoints, blueEdges, operation);
        const contour = overlayResult.points.map((point) => {
            return GeohashExtra.encodeFromLatLng(point[0], point[1], redContour[0].length);
        });

        const concatEdges = overlayResult.blue.concat(overlayResult.red);

        const sortedPoints = GeohashContour.pointsSortByEdges(overlayResult.points, concatEdges);
        
        const sortedContour = sortedPoints.map((point) => {
            return GeohashExtra.encodeFromLatLng(point[0], point[1], redContour[0].length);
        });
        return {
            red: overlayResult.red,
            blue: overlayResult.blue,
            points: overlayResult.points,
            contour: contour,
            sortedContour: sortedContour
        };
    }

    /**
     * Sort points array by edges array of overlay operation
     * @param points
     * @param edges
     * @returns {Array}
     */
    static pointsSortByEdges(points, edges) {
        if(!edges.length) {
            return points;
        }
        
        const edgesStack = edges.map(edge => edge);
        
        let sortedPoints = [];
        
        const firstEdge = edges[0];
        
        addPointByEdge(firstEdge);
        
        function addPointByEdge(addEdge, i = 0) {
            if(addEdge[0] === firstEdge[0] && i > 0) {
                return;
            }
            if(i > points.length) {
                sortedPoints = points;
                return;
            }
            sortedPoints.push(points[addEdge[0]]);
            
            let nextEdge;
            const foundEdgeByBeginning = _.find(edgesStack, (edge) => edge[0] === addEdge[1]);
            if(foundEdgeByBeginning) {
                nextEdge = foundEdgeByBeginning;
                edgesStack.splice(edgesStack.indexOf(foundEdgeByBeginning), 1);
            } else {
                const foundEdgeByEnd = _.find(edgesStack, (edge) => edge[1] === addEdge[1] && edge[0] !== addEdge[0]);
                nextEdge = [foundEdgeByEnd[1], foundEdgeByEnd[0]];
                edgesStack.splice(edgesStack.indexOf(foundEdgeByEnd), 1);
            }
            addPointByEdge(nextEdge, ++i);
        }
        
        return sortedPoints;
    }

    /**
     * Check - is split possible for two contours
     * @param baseContour
     * @param splitContour
     * @returns {boolean}
     */
    static splitPossible(baseContour, splitContour) {
        const andResult = GeohashContour.overlay(baseContour, splitContour, "and");
        if(!andResult.points.length || andResult.contour.length > andResult.sortedContour.length) {
            return false;
        }

        const subResult = GeohashContour.overlay(baseContour, splitContour, "sub");
        if(!subResult.points.length || subResult.contour.length > subResult.sortedContour.length) {
            return false;
        }

        return true;
    }

    /**
     * Split contours and returns result contours
     * @param baseContour
     * @param splitContour
     * @returns {base, split}
     */
    static splitContours(baseContour, splitContour) {
        if(!GeohashContour.splitPossible(baseContour, splitContour)) {
            return {
                base: baseContour,
                split: splitContour
            };
        }
        return {
            base: GeohashContour.overlay(baseContour, splitContour, "rsub").sortedContour,
            split: GeohashContour.overlay(baseContour, splitContour, "and").sortedContour
        };
    }

    /**
     * Check - is merge possible for two contours
     * @param baseContour
     * @param mergeContour
     * @returns {boolean}
     */
    static mergePossible(baseContour, mergeContour) {
        let mergePossible = false;
        baseContour.some(geohash => {
            mergePossible = mergePossible || mergeContour.indexOf(geohash) !== -1;
            return mergePossible;
        });

        if (mergePossible) {
            return mergePossible;
        }

        return GeohashContour.overlay(baseContour, mergeContour, "and").points.length > 0;
    }

    /**
     * Merge contours and returns result contour
     * @param baseContour
     * @param mergeContour
     * @param filterByInsideContourGeohashes
     * @returns [geohash]
     */
    static mergeContours(baseContour, mergeContour, filterByInsideContourGeohashes = true) {
        if (!GeohashContour.mergePossible(baseContour, mergeContour)) {
            return [];
        }
        const resultContour = GeohashContour.overlay(baseContour, mergeContour, "or").sortedContour;

        if (filterByInsideContourGeohashes) {
            return resultContour.filter(geohash => {
                // Check and delete geohashes, which fully inside result contour(not on edge)
                return !GeohashContour.isGeohashInsideContour(geohash, resultContour, true);
            });
        } else {
            return resultContour;
        }
    }

    static bboxes(contour, precision) {
        let maxLat;
        let minLat;
        let maxLon;
        let minLon;

        contour.forEach((geohash) => {
            const coordinates = GeohashExtra.decodeToLatLon(geohash);

            if (_.isNil(maxLat) || coordinates.lat > maxLat) {
                maxLat = coordinates.lat;
            }
            if (_.isNil(minLat) || coordinates.lat < minLat) {
                minLat = coordinates.lat;
            }
            if (_.isNil(maxLon) || coordinates.lon > maxLon) {
                maxLon = coordinates.lon;
            }
            if (_.isNil(minLon) || coordinates.lon < minLon) {
                minLon = coordinates.lon;
            }
        });

        return ngeohash.bboxes(minLat, minLon, maxLat, maxLon, precision);
    }

    /**
     * Find geohash, which contains in contour by geohash precision
     * @param contour
     * @param precision
     * @param processCallback
     * @returns {Array}
     */
    static approximate(contour, precision, processCallback) {
        const polygon = contour.map((geohash) => {
            const coordinates = GeohashExtra.decodeToLatLon(geohash);
            return [coordinates.lat, coordinates.lon];
        });

        const allGeohashes = GeohashContour.bboxes(contour, precision);

        const geohashesInside = [];
        const parentsToChildren = {};
        const parentsForMerge = [];

        allGeohashes.forEach((geohash, index) => {
            if (GeohashContour.isGeohashInside(geohash, polygon, contour)) {

                geohashesInside.push(geohash);

                const parent = Geohash.getParent(geohash);
                if (!parentsToChildren[parent]) {
                    parentsToChildren[parent] = [];
                }
                parentsToChildren[parent].push(geohash);

                if (parentsToChildren[parent].length === 32) {
                    parentsForMerge.push(parent);
                }
            }

            const geohashNumber = index + 1;
            if (processCallback && index && (index % 1000 === 0 || allGeohashes.length === geohashNumber)) {
                processCallback("entryCheck", geohashNumber, allGeohashes.length);
            }
        });

        for (let i = 0; i < parentsForMerge.length; i++) {
            const geohashParent = parentsForMerge[i];

            parentsToChildren[geohashParent].forEach((geohash) => {
                geohashesInside.splice(geohashesInside.indexOf(geohash), 1);
            });
            geohashesInside.push(geohashParent);

            const parentOfParent = Geohash.getParent(geohashParent);
            if (!parentsToChildren[parentOfParent]) {
                parentsToChildren[parentOfParent] = [];
            }
            parentsToChildren[parentOfParent].push(geohashParent);

            if (parentsToChildren[parentOfParent].length === 32) {
                parentsForMerge.push(parentOfParent);
            }

            const geohashNumber = i + 1;
            if (processCallback && i && (i % 100 === 0 || parentsForMerge.length === geohashNumber)) {
                processCallback("parentsMerge", geohashNumber, parentsForMerge.length);
            }
        }

        return geohashesInside;
    }

    static isGeohashInside(geohash, latLngPolygon, strict = true) {
        if(!strict) {
            const latLon = GeohashExtra.decodeToLatLon(geohash);
            return GeohashContour.isInside([latLon.lat, latLon.lon], latLngPolygon);
        }
        const neChild = Geohash.getChildByDirection(Geohash.getChildByDirection(geohash, 'ne'), 'ne');
        const seChild = Geohash.getChildByDirection(Geohash.getChildByDirection(geohash, 'se'), 'se');
        const nwChild = Geohash.getChildByDirection(Geohash.getChildByDirection(geohash, 'nw'), 'nw');
        const swChild = Geohash.getChildByDirection(Geohash.getChildByDirection(geohash, 'sw'), 'sw');

        const neCoor = GeohashExtra.decodeToLatLon(neChild);
        const seCoor = GeohashExtra.decodeToLatLon(seChild);
        const nwCoor = GeohashExtra.decodeToLatLon(nwChild);
        const swCoor = GeohashExtra.decodeToLatLon(swChild);

        return GeohashContour.isInside([neCoor.lat, neCoor.lon], latLngPolygon)
            && GeohashContour.isInside([seCoor.lat, seCoor.lon], latLngPolygon)
            && GeohashContour.isInside([nwCoor.lat, nwCoor.lon], latLngPolygon)
            && GeohashContour.isInside([swCoor.lat, swCoor.lon], latLngPolygon);
    }


    static isGeohashInsideContour(geohash, contour, strict = true) {
        const polygon = contour.map((geohash) => {
            const coordinates = GeohashExtra.decodeToLatLon(geohash);
            return [coordinates.lat, coordinates.lon];
        });

        return GeohashContour.isGeohashInside(geohash, polygon, strict);
    }

    static middleGeohashOfLine(geohash1, geohash2) {
        const point1 = GeohashExtra.decodeToLatLon(geohash1);
        const point2 = GeohashExtra.decodeToLatLon(geohash2);

        return GeohashExtra.encodeFromLatLng((point1.lat + point2.lat) / 2, (point1.lon + point2.lon) / 2, geohash1.length);
    }

    // https://github.com/substack/point-in-polygon
    static isInside(point, polygon) {
        let x;
        let y;
        let xi;
        let xj;
        let yi;
        let yj;

        x = point[0], y = point[1];

        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            xi = polygon[i][0], yi = polygon[i][1];
            xj = polygon[j][0], yj = polygon[j][1];

            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }
    
    static intersectsGeohashesLines(geohash1Line1, geohash2Line1, geohash1Line2, geohash2Line2){
        return GeohashContour.intersectsLines(
            GeohashExtra.decodeToLatLon(geohash1Line1, true),
            GeohashExtra.decodeToLatLon(geohash2Line1, true),
            GeohashExtra.decodeToLatLon(geohash1Line2, true),
            GeohashExtra.decodeToLatLon(geohash2Line2, true)
        );
    }

    // https://stackoverflow.com/a/24392281/6053486
    static intersectsLines(point1Line1, point2Line1, point1Line2, point2Line2) {
        const a = point1Line1[0],
            b = point1Line1[1];
        
        const c = point2Line1[0],
            d = point2Line1[1];

        const p = point1Line2[0],
            q = point1Line2[1];

        const r = point2Line2[0],
            s = point2Line2[1];
        
        let det, gamma, lambda;
        det = (c - a) * (s - q) - (r - p) * (d - b);
        if (det === 0) {
            return false;
        } else {
            lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;
            gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;
            return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
        }
    };

    /**
     * Filter geohashes list by contains in contour
     * @param geohashes
     * @param contour
     * @returns {*}
     */
    static filterByInside(geohashes, contour) {
        const polygon = [];

        contour.forEach((geohash) => {
            const coordinates = GeohashExtra.decodeToLatLon(geohash);
            polygon.push([coordinates.lat, coordinates.lon]);
        });

        return geohashes.filter((geohash) => {
            return GeohashContour.isGeohashInside(geohash, polygon);
        })
    }
};